'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const removal = require('../scripts/toolkit-remove.cjs');
const s = require('./support/legacy-task-world.cjs');
const { parseFrontMatter } = require('../scripts/validate-toolkit.cjs');

// One repository's old footer cleaner, as an earlier release's task apply left it on the fake scheduler.
function enrol(t, world, name) {
  const root = s.checkout(t);
  const entry = s.enrolLegacy({ home: world.home, scheduler: world.scheduler, root, name });
  return { root, entry, live: () => world.scheduler.folders.get(entry.folder)?.find(task => task.name === entry.name) };
}

function world(t) {
  return { home: s.tempHome(t), scheduler: s.fakeScheduler() };
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
const adopt = (w, folder, name, id) => s.adoptLegacy({ home: w.home, scheduler: w.scheduler, folder, name, id });
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
  const text = removal.describePlan(plan).join('\n');
  assert.match(text, /\*\*Removed\*\*\n- \*\*Old scheduled tasks:\*\* \\[^\n]+ and \\[^\n]+, from an earlier Toolkit; their task files and empty Task Scheduler folders go too/);
  assert.match(text, /\*\*Kept\*\*\n- \*\*Scheduled task:\*\* \\MINE\\Nightly backup: yours \(only listed by Toolkit\); delete it in Task Scheduler yourself if you want it gone/);
  // The plan code is for the agent only, below the owner's screen.
  const [screen, agent] = text.split(removal.AGENT_LINE);
  assert.doesNotMatch(screen, /[a-f0-9]{64}/);
  assert.match(agent, new RegExp(`apply --app all --confirm ${plan.code}\\.`));
  assert.ok(w.scheduler.calls.slice(before).every(call => ['list', 'marked-folders'].includes(call[0])), `plan is read-only: ${JSON.stringify(w.scheduler.calls.slice(before))}`);

  const result = owner(w).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.tasks.map(item => item.result), ['removed', 'removed']);
  assert.equal(w.scheduler.folders.has(one.entry.folder), false);
  assert.equal(w.scheduler.folders.has(two.entry.folder), false);
  assert.equal(w.scheduler.folders.get('MINE').length, 1);
  assert.deepEqual(tasks.readRegistry(w.home).tasks.map(entry => entry.id), ['nightly-backup']);
  assert.equal(fs.existsSync(windows.runnersDir(w.home)), false, 'the shared runner goes with the last Toolkit task');
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
  { row: 'disabled by the launcher, then changed', arrange: (w, e) => { disable(w, e); e.live().definition_xml = '<edited/>'; }, kind: 'changed', action: 'keep', gone: false },
  { row: 'marker removed by hand', arrange: (w, e) => { e.live().description = 'mine now'; }, kind: 'changed', action: 'keep', gone: false },
];
function disable(w, e) {
  const live = e.live();
  live.state = 'Disabled'; live.description = windows.DISABLED_DESCRIPTION; live.definition_xml = '<disabled-fixture/>';
  tasks.updateRegistry(w.home, list => list.map(entry => entry.id === e.entry.id ? { ...entry, toolkit_missing: true, enrolled: { ...entry.enrolled, description: windows.DISABLED_DESCRIPTION, enabled: false, definition_xml: live.definition_xml } } : entry));
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
    assert.equal(fs.existsSync(windows.runnersDir(w.home)), true, 'a kept task keeps its runner');
  }
});

// A changed task with no marker may no longer be Toolkit's at all, so --include cannot name it and the
// plan does not offer it; a changed task that still carries the marker can still be named.
for (const row of MATRIX.filter(item => item.kind === 'changed' && !item.include)) test(`removal matrix: ${row.row}, named with --include`, t => {
  const w = world(t), e = enrol(t, w, 'widget');
  row.arrange(w, e);
  const text = removal.describePlan(owner(w).plan()).join('\n');
  const marked = row.row === 'changed by hand';
  assert.equal(text.includes(`say to remove ${e.entry.id} too if you want it gone`), marked);
  if (marked) {
    assert.equal(owner(w, { include: [e.entry.id] }).plan().tasks.find(task => task.id === e.entry.id).action, 'remove');
    assert.match(removal.describePlan(owner(w, { include: [e.entry.id] }).plan()).join('\n'), new RegExp(`apply --app all --include ${e.entry.id} --confirm`));
  } else {
    assert.match(text, /delete it in Task Scheduler yourself/);
    assert.throws(() => owner(w, { include: [e.entry.id] }).plan(), /no longer carries Toolkit's marker .* Delete it in Task Scheduler/);
    assert.ok(e.live(), 'the task is untouched');
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

// A task carrying a recorded task's marker in another folder was copied or moved by hand: kept.
test('a marked copy of a recorded task in another folder is kept unless named', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const copy = { ...e.live(), name: 'My copy' };
  w.scheduler.folders.set('MINE', [copy]);
  const plan = owner(w).plan();
  const item = plan.tasks.find(task => task.folder === 'MINE');
  assert.equal(item.kind, 'changed');
  assert.equal(item.action, 'keep');
  owner(w).apply(plan.code);
  assert.deepEqual(w.scheduler.folders.get('MINE').map(task => task.name), ['My copy']);
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
  assert.equal(fs.existsSync(windows.runnersDir(w.home)), true);
});

test('global rules: a present block is removed through the rules owner, a broken file is reported and left', t => {
  const w = world(t); enrol(t, w, 'widget');
  const rules = fakeRules({ 'claude-code': 'current', codex: 'broken' });
  const plan = owner(w, { rules: rules.factory }).plan();
  assert.deepEqual(plan.rules.map(file => file.action), ['remove', 'held']);
  const text = removal.describePlan(plan).join('\n');
  assert.match(text, /- \*\*Global rules:\*\* the Toolkit block in ~\/claude-code\/rules\.md \(the rest of the file stays\)/);
  assert.match(text, /\*\*Kept\*\*\n- \*\*Global rules:\*\* ~\/codex\/rules\.md: left alone, the Toolkit markers are broken; fix or remove the Toolkit lines by hand/);
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
  const runFolder = path.join(tasks.userStateDir(w.home), 'tasks', e.entry.id);
  fs.mkdirSync(runFolder, { recursive: true });
  fs.writeFileSync(path.join(runFolder, 'last-run.json'), '{"status":"ok"}\n');
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

// Only true lines: a system with no Task Scheduler never had Toolkit's Windows tasks, so the plan says
// nothing about them.
test('without a Task Scheduler the plan has no task line and leaves task records alone', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const plan = new removal.ToolkitRemoval({ home: w.home, scheduler: null, rules: null }).plan();
  assert.equal(plan.scheduler, 'not available on this system');
  assert.deepEqual([plan.tasks, plan.stale_records, plan.state], [[], [], []]);
  assert.doesNotMatch(removal.describePlan(plan).join('\n'), /[Ss]cheduled task|Task Scheduler/);
  assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id));
});

test('command line: plan prints the list and the code, apply needs the code, bad arguments print usage', t => {
  const w = world(t); enrol(t, w, 'widget');
  // The default parts would read this computer's own temp folder and Claude app folder, so the command
  // line runs over none of them here; the parts have their own tests.
  const run = argv => { const out = [], err = []; const code = removal.main(argv, { home: w.home, scheduler: w.scheduler, rules: null, parts: [], plugins: () => ({}), platform: 'win32', environment: { HOME: w.home, USERPROFILE: w.home }, log: line => out.push(line), error: line => err.push(line) }); return { code, out: out.join('\n'), err: err.join('\n') }; };
  // The agent asks the owner first whether to remove from this app only or every app; without the answer nothing runs.
  const unasked = run(['plan']);
  assert.equal(unasked.code, 1);
  assert.match(unasked.err, /remove needs --app: ask the owner first whether to remove Toolkit from only this app .* or from every app \(--app all\)/);
  assert.equal(run(['plan', '--app', 'everywhere']).code, 1);
  // No other app has the plugin here, so a one-app plan says the shared parts go too.
  const codexOnly = run(['plan', '--app', 'codex']).out;
  assert.match(codexOnly, /\*\*From:\*\* Codex only; no other app has the Toolkit plugin, so the shared parts below go too\./);
  assert.match(codexOnly, /- \*\*Old scheduled tasks:\*\* [^\n]+, from an earlier Toolkit/);
  assert.doesNotMatch(codexOnly, /Shared parts|--app all/);
  const plan = run(['plan', '--app', 'all']);
  assert.equal(plan.code, 0);
  const code = /--confirm ([a-f0-9]{64})/.exec(plan.out)[1];
  assert.match(plan.out, /\*\*From:\*\* every app on this computer\./);
  assert.equal(run(['plan', '--app', 'all', '--full']).out, plan.out, 'nothing folded here, so --full shows the same list');
  assert.equal(run(['apply', '--app', 'all', '--full', '--confirm', code]).code, 1, '--full is a plan option only');
  assert.equal(JSON.parse(run(['plan', '--app', 'all', '--json']).out).code, code);
  assert.notEqual(JSON.parse(run(['plan', '--app', 'codex', '--json']).out).code, code, 'the app is in the plan code');
  assert.deepEqual([run(['apply', '--app', 'all']).code, run(['apply', '--app', 'all', '--confirm', 'nope']).code, run(['sweep']).code, run(['plan', '--app', 'all', '--confirm', code]).code, run(['apply', '--confirm', code]).code], [1, 1, 1, 1, 1]);
  assert.match(run(['apply', '--app', 'all']).err, /apply needs --confirm/);
  const wrong = run(['apply', '--app', 'all', '--confirm', '0'.repeat(64)]);
  assert.equal(wrong.code, 1); assert.match(wrong.err, /nothing was removed/);
  const done = run(['apply', '--app', 'all', '--confirm', code]);
  assert.equal(done.code, 0); assert.match(done.out, /\*\*Toolkit removal done\*\*/); assert.match(done.out, /\*\*Removed\*\*\n- \*\*Old scheduled tasks:\*\* /);
});

test('the real scheduler removes a launcher-disabled task only with its exact recorded definition', () => {
  const payloads = [];
  const run = (file, args, options) => { payloads.push(JSON.parse(options.env.TOOLKIT_TASK_PAYLOAD)); return { status: 0, stdout: '{"removed":true}', stderr: '' }; };
  const scheduler = windows.powerShellScheduler({ run });
  assert.throws(() => scheduler.unregisterDisabled('WIDGET', 'WIDGET - Footer sweep', { definition_xml: null }), /left alone/);
  assert.equal(payloads.length, 0);
  assert.deepEqual(scheduler.unregisterDisabled('WIDGET', 'WIDGET - Footer sweep', { definition_xml: '<x/>' }), { removed: true });
  assert.deepEqual(payloads[0], { folder: 'WIDGET', name: 'WIDGET - Footer sweep', marker: windows.DISABLED_DESCRIPTION, expected_xml: '<x/>' });
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
  assert.match(text, /- \*\*Codex instruction limit:\*\* project_doc_max_bytes in ~\/\.codex\/config\.toml goes back to 32768\n/);
  assert.match(text, /\*\*Never touched\*\*\n- Your repositories, your keys \(in the credential store\)/);
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
  assert.match(removal.describeResult(result).join('\n'), /- \*\*Codex instruction limit:\*\* ~\/\.codex\/config\.toml: put back to the earlier value; Codex load check: verified/);
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
  assert.match(removal.describePlan(plan).join('\n'), /- \*\*Codex instruction limit:\*\* ~\/\.codex\/config\.toml, which Toolkit created for its project_doc_max_bytes line alone/);
  assert.equal(plan.nothing, false);
  const result = owner(w, { rules: rules.factory }).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(rules.codex), false);
  assert.equal(result.codex_settings.result, 'deleted-file');
  const damaged = `model = "example"\n${limitBlock('none')}\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\n`;
  fs.writeFileSync(rules.codex, damaged);
  const held = owner(w, { rules: rules.factory }).plan();
  assert.equal(held.codex_settings.action, 'held');
  assert.match(removal.describePlan(held).join('\n'), /\*\*Kept\*\*\n- \*\*Codex instruction limit:\*\* ~\/\.codex\/config\.toml: left alone, the Toolkit markers are not one intact pair/);
  const after = owner(w, { rules: rules.factory }).apply(held.code);
  assert.equal(fs.readFileSync(rules.codex, 'utf8'), damaged);
  assert.equal(after.codex_settings, null);
  assert.equal(after.held_codex_settings.action, 'held');
});

// The plan said the damaged Codex line is left alone; removing the rules blocks must not turn that
// planned hold into a failure or print the Codex line twice.
test('Codex settings: damaged markers left alone while the rules blocks go is the planned outcome, shown once', t => {
  const w = world(t);
  const rules = realRules(w, []);
  const damaged = `model = "example"\n${limitBlock('none')}\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\n`;
  fs.writeFileSync(rules.codex, damaged);
  const plan = owner(w, { rules: rules.factory }).plan();
  assert.equal(plan.codex_settings.action, 'held');
  assert.ok(plan.rules.some(file => file.action === 'remove'), JSON.stringify(plan.rules));
  const result = owner(w, { rules: rules.factory }).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.codex_settings, null);
  const text = removal.describeResult(result).join('\n');
  assert.equal((text.match(/Codex instruction limit/g) || []).length, 1, text);
  assert.match(text, /\*\*Toolkit removal done\*\*/);
  assert.equal(fs.readFileSync(rules.codex, 'utf8'), damaged);
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
  for (const file of ['source/repo/README.md', 'current/state.json', 'user-state/tmp/scrap.txt', 'env/manifest.json', 'backups/global-rules/a.md', 'agent-control/backups/claude-settings/b.json', 'agent-control/profile.json', 'antigravity-refresh/source.json', 'antigravity-refresh/update.lock', 'notes/mine.txt', 'recovery-identities/r.json',
    // The bridge's short-lived lock and staging leftovers.
    'update.lock.recovery', 'update.lock.recovery.claim-0123456789abcdef', 'update.lock.displaced.01234567-89ab-cdef-0123-456789abcdef', '.staging-01234567-89ab-cdef-0123-456789abcdef/x',
    '.toolkit-staging-generation-01234567-89ab-cdef-0123-456789abcdef.json', '.current.backup-123-456/x',
    // The update records the bridge keeps beside its hub snapshot.
    'remote-check.json', 'agent-rules-notices.json', 'hook-skips.json', 'update.readers/123-abc', 'update.lock', 'update.tree-moving']) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), 'x');
  }
  const installed = { 'claude-code': true, codex: false };
  const delegation = { calls: [], RUNTIMES: { UNKNOWN: 'unknown', V1: 'v1', V2: 'v2' }, owned: true,
    inspectCodexDelegationConfig() { return this.owned ? { ownership: 'toolkit-managed-v2', helper_count: 2 } : { ownership: 'none', status: 'unconfigured' }; },
    removeCodexDelegation(file, options) { this.calls.push([file, options]); this.owned = false; return { status: 'removed', changed: true }; } };
  const list = [new parts.ClaudeDepthPart({ environment: { ...environment, AI_AGENT_TOOLKIT_CONTROL_ROOT: control }, home }),
    new parts.ClaudeUserSettingsPart({ environment: { ...environment, AI_AGENT_TOOLKIT_CONTROL_ROOT: control }, home }),
    new parts.CodexHelperLimitPart({ environment, home, delegation }), new parts.HelperAgentFilesPart({ environment, home }),
    new parts.SkillCopiesPart({ environment, home, toolkitRoot: REPO_ROOT }), new parts.ToolkitFolderPart({ home, environment, plugins: () => installed })];
  const make = (options = {}) => new removal.ToolkitRemoval({ home, parts: list, plugins: () => installed, ...options });
  return { home, environment, depth, agents, folder, installed, delegation, make };
}

test('full removal: settings, helper files and skill copies go after the OK; the folder waits for the plugins, then goes keeping only the key list, the recovery records and the last removal\'s backup', t => {
  const h = fullHome(t);
  const plan = h.make().plan();
  const text = removal.describePlan(plan).join('\n');
  const [screen, agent] = text.split(removal.AGENT_LINE);
  assert.equal(plan.nothing, false);
  assert.deepEqual(plan.plugins, ['claude-code']);
  assert.match(screen, /^\*\*Remove Toolkit from this computer\*\*\n\n\*\*From:\*\* every app on this computer\.\n\n\*\*Removed\*\*\n- \*\*Plugin:\*\* AI Agent Toolkit in Claude Code, uninstalled after your yes\n/);
  assert.match(screen, /- \*\*Claude Code subagent limit:\*\* CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH in ~\/\.claude\/settings\.json \(Toolkit's value; Claude Code goes back to its default\)/);
  // The owner's wording for the attribution setting setup turned on.
  assert.match(screen, /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*No AI credit in commits:\*\* a Claude Code setting setup turned on; change it in ~\/\.claude\/settings\.json\n/);
  assert.doesNotMatch(screen, /Claude Code settings from setup/, 'no other setting from setup is set here');
  assert.match(screen, /- \*\*Codex helper limit:\*\* Toolkit's block in ~\/\.codex\/config\.toml \(2 helpers; Codex may then use its own higher default\)/);
  assert.match(screen, /- \*\*Helper agents:\*\* ~\/\.claude\/agents\/toolkit-g0\.md and ~\/\.codex\/agents\/toolkit-g1\.toml\n/);
  assert.doesNotMatch(screen, /my-reviewer|my-skill/);
  // Long lists fold into a count; --full unfolds them, and the code stays the same.
  assert.match(screen, /- \*\*Skill copies:\*\* \d+ skill folders Toolkit copied in ~\/\.claude\/skills \(full list on request\)/);
  assert.match(screen, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: the Toolkit checkout, its records and locks, and \d+ older backup files of Toolkit's own \(\d+ items, full list on request\); it goes last, once no Toolkit plugin or Toolkit permission line is left/);
  assert.match(screen, /- \*\*Your key list:\*\* ~\/\.ai-agent-toolkit\/env: the keys themselves stay in the credential store/);
  assert.match(screen, /- \*\*Recovery records:\*\* ~\/\.ai-agent-toolkit\/recovery-identities: the evidence of outside resources checked before a live change/);
  assert.match(screen, /- \*\*Not Toolkit's:\*\* ~\/\.ai-agent-toolkit\/notes\n/);
  assert.match(screen, /- \*\*This removal's backup:\*\* ~\/\.ai-agent-toolkit\/backups\/remove-toolkit, the copies of the files this removal changes/);
  assert.match(agent, /The full lists, when the owner asks: run plan --app all --full\./);
  const full = removal.describePlan(plan, { full: true }).join('\n');
  assert.match(full, /- \*\*Skill copies:\*\*\n  - ~\/\.claude\/skills\//);
  assert.match(full, /  - ~\/\.ai-agent-toolkit\/agent-control \(\d+ older backup files? of Toolkit's own\)\n/);
  assert.match(full, /  - ~\/\.ai-agent-toolkit\/backups \(1 older backup file of Toolkit's own\)\n/);
  assert.match(full, /  - ~\/\.ai-agent-toolkit\/antigravity-refresh\n/);
  for (const name of ['remote-check.json', 'agent-rules-notices.json', 'hook-skips.json', 'update.readers', 'update.lock', 'update.lock.recovery', 'update.tree-moving', 'source', 'current', 'user-state',
    'update.lock.recovery.claim-0123456789abcdef', 'update.lock.displaced.01234567-89ab-cdef-0123-456789abcdef', '.staging-01234567-89ab-cdef-0123-456789abcdef',
    '.toolkit-staging-generation-01234567-89ab-cdef-0123-456789abcdef.json', '.current.backup-123-456']) assert.ok(full.includes(`  - ~/.ai-agent-toolkit/${name}\n`), name);
  assert.doesNotMatch(full, /The full lists/);
  // The plugin uninstall lines are the agent's own step, never on the owner's screen.
  assert.doesNotMatch(screen, /`claude plugin|codex plugin|--confirm|[a-f0-9]{64}/);
  assert.match(agent, /- After the owner's yes, first:\n  - Uninstall the Claude Code plugin: `claude plugin uninstall ai-agent-toolkit@ai-agent-toolkit-local`, then `claude plugin marketplace remove ai-agent-toolkit-local`\. Without its command line, ask the owner to type \/plugin, open AI Agent Toolkit and choose Uninstall\./);
  assert.doesNotMatch(agent, /codex plugin remove/);
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
  const [closing, steps] = after.split(removal.AGENT_LINE);
  assert.match(closing, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: the Claude Code plugin is still installed and reads its records there/);
  assert.match(closing, /\*\*Next\*\*\n- \*\*Still to do:\*\* the Toolkit plugin is still installed in Claude Code, so the Toolkit folder stays\. Once it is uninstalled, say `remove toolkit` again to remove the folder/);
  assert.doesNotMatch(closing, /`claude plugin|node "/);
  assert.match(steps, /- Uninstall the Claude Code plugin: `claude plugin uninstall/);
  assert.match(steps, /the skill is gone, run: node "[^"]*toolkit-remove\.cjs" plan --app all/);
  // This removal's backup (the subagent limit's settings copy) was gathered although the folder stays.
  const gathered = fs.readdirSync(path.join(h.folder, 'backups', 'remove-toolkit'));
  assert.equal(gathered.length, 1);
  assert.ok(fs.readdirSync(path.join(h.folder, 'backups', 'remove-toolkit', gathered[0], 'agent-control', 'claude-settings')).length > 0);
  // Once the plugin is gone, a second run lists only the folder and removes Toolkit's entries; it saves
  // no backup of its own, so the last removal's backup stays and every older one goes.
  h.installed['claude-code'] = false;
  const second = h.make().plan();
  assert.deepEqual(second.parts.filter(part => part.items.some(item => item.action === 'remove')).map(part => part.key), ['toolkit_folder']);
  assert.match(removal.describePlan(second).join('\n'), /- \*\*The last removal's backup:\*\* ~\/\.ai-agent-toolkit\/backups\/remove-toolkit\n/);
  const done = h.make().apply(second.code);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.folder_kept, false);
  assert.deepEqual(fs.readdirSync(h.folder).sort(), ['backups', 'env', 'notes', 'recovery-identities']);
  assert.deepEqual(fs.readdirSync(path.join(h.folder, 'backups')), ['remove-toolkit']);
  assert.deepEqual(fs.readdirSync(path.join(h.folder, 'backups', 'remove-toolkit')), gathered);
  assert.equal(fs.readFileSync(path.join(h.folder, 'env', 'manifest.json'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(h.folder, 'recovery-identities', 'r.json'), 'utf8'), 'x');
  const last = removal.describeResult(done).join('\n');
  assert.match(last, /- \*\*New session:\*\* start a new session in each app/);
  // The closing line for older backups says whose they are, as the plan does (G2 of PR 1552, delta L1).
  const backupsGone = done.parts.find(part => part.key === 'toolkit_folder').results.find(item => item.what === '~/.ai-agent-toolkit/backups');
  assert.match(backupsGone.reason, /^\d+ older backup files? of Toolkit's own$/);
  assert.equal(h.make().plan().nothing, true);
});

// Owner decision INT-TK421-1364: a full removal leaves only the key list, the recovery records and
// this removal's backup, which replaces the last removal's.
test('the Toolkit folder: a removal that saves a backup replaces the last removal\'s and every older backup goes', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  for (const file of ['backups/remove-toolkit/2026-01-01T00-00-00-000Z/old.json', 'backups/global-rules/2026-01-01T00-00-00-000Z/AGENTS.md', 'agent-control/backups/claude-settings/s.json', 'env/manifest.json', 'source/x'])
    { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), 'old'); }
  const writer = { key: 'writer', title: 'Writer', plan: () => [{ what: 'a setting', action: 'remove', backup: true }],
    apply: () => { const file = path.join(folder, 'backups', 'global-rules', '2026-11-26T00-00-00-000Z', 'AGENTS.md'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'new'); return [{ what: 'a setting', result: 'removed' }]; } };
  const folderPart = new parts.ToolkitFolderPart({ home, plugins: () => ({}), now: () => new Date('2026-11-26T12:00:00Z') });
  const make = () => new removal.ToolkitRemoval({ home, parts: [writer, folderPart], plugins: () => ({}) });
  const plan = make().plan();
  const items = plan.parts.find(part => part.key === 'toolkit_folder').items;
  assert.deepEqual(items.filter(item => item.action === 'remove').map(item => [item.what, item.older || 0]),
    [['~/.ai-agent-toolkit/agent-control', 1], ['~/.ai-agent-toolkit/backups', 2], ['~/.ai-agent-toolkit/source', 0]]);
  assert.deepEqual(items.filter(item => item.action === 'save').map(item => item.label), ["This removal's backup"]);
  assert.equal(items.some(item => item.label === "The last removal's backup"), false, 'it is replaced, so it is not listed as kept');
  const result = make().apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(treeOf(folder), {
    [path.join('backups', 'remove-toolkit', '2026-11-26T12-00-00-000Z', 'global-rules', '2026-11-26T00-00-00-000Z', 'AGENTS.md')]: Buffer.from('new').toString('hex'),
    [path.join('env', 'manifest.json')]: Buffer.from('old').toString('hex'),
  });
  assert.match(removal.describeResult(result).join('\n'), /- \*\*This removal's backup:\*\* ~\/\.ai-agent-toolkit\/backups\/remove-toolkit\n/);
});

// Owner decision INT-TK421-1364: an MCP server whose key helper runs from the Toolkit folder is named
// only when this removal deletes that helper, and the closing lines say how to connect it again.
test('MCP servers: named only when the removal deletes their key helper; the closing lines say how to reconnect, and their settings stay', t => {
  const home = s.tempHome(t);
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const script = path.join(home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'toolkit-env.cjs');
  fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, '');
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://example.test/mcp', headersHelper: `node "${script}" header GITHUB_TOKEN` } } }));
  const before = fs.readFileSync(claudeJson);
  const installed = { 'claude-code': false, codex: true };
  const make = app => {
    const folder = new parts.ToolkitFolderPart({ home, environment, plugins: () => installed });
    return new removal.ToolkitRemoval({ home, app, parts: [folder, new parts.McpKeyHelpersPart({ environment, home, folder })], plugins: () => installed });
  };
  // Codex still has Toolkit, so a Claude Code removal keeps the folder and the helper: no MCP line.
  assert.doesNotMatch(removal.describePlan(make('claude-code').plan()).join('\n'), /MCP|github/);
  installed.codex = false;
  const plan = make('all').plan();
  assert.match(removal.describePlan(plan).join('\n'), /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*MCP servers:\*\* github \(Claude Code\) keeps its settings and key, but its key helper runs from the Toolkit folder, which goes; the closing lines say how to connect it again\n/);
  const result = make('all').apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  const closing = removal.describeResult(result).join('\n');
  assert.match(closing, /\*\*Next\*\*\n- \*\*Reconnect MCP servers:\*\* github \(Claude Code\) keeps its settings and key, but lost the key helper with the Toolkit folder\. To use it again, give it its key another way \(in its own settings or the service's sign-in\), or say `setup toolkit` and then `toolkit env`/);
  assert.doesNotMatch(closing.split('**Next**')[0], /github/, 'named once, in the closing lines');
  assert.deepEqual(fs.readFileSync(claudeJson), before, 'its settings stay byte for byte');
});

// G2 round 1 M1 (PR 1552): the backups other Toolkit features keep for the owner are the owner's data,
// not Toolkit's rebuildable copies: the retired ~/.codex/.env (toolkit env says it never deletes it), the
// feeder backups `toolkit env revoke --feeders` restores from (the kept env record points at them) and
// memory tidy's backups (its restore reads them). A full removal keeps and names them.
test('the Toolkit folder: a full removal keeps the backups Toolkit holds for the owner, names them, and revoke still finds its feeder backup', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  const feederBackup = path.join(folder, 'backups', 'env-feeders', '2026-11-02T00-00-00-000Z-github');
  const owned = {
    'backups/env-retire-2026-11-01T00-00-00-000Z/codex.env': '# my own note about the staging key\nEXAMPLE_TOKEN=fake-value-for-test\n',
    'backups/env-feeders/2026-11-02T00-00-00-000Z-github/claude-code-github.json': JSON.stringify({ server: 'github', entry: { type: 'http', url: 'https://example.test/mcp' } }),
    'backups/memory-tidy/folder-1/preview-abc/MEMORY.md': '- [A note](a.md) - owner memory\n',
    'env/manifest.json': JSON.stringify({ bindings: [{ harness: 'claude-code', server: 'github', name: 'GITHUB_TOKEN', backup: feederBackup }] }),
  };
  for (const [file, text] of Object.entries({ ...owned, 'backups/global-rules/2026-01-01T00-00-00-000Z/AGENTS.md': 'old', 'source/repo/README.md': 'x' }))
    { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), text); }
  const make = () => new removal.ToolkitRemoval({ home, parts: [new parts.ToolkitFolderPart({ home, plugins: () => ({}) })], plugins: () => ({}) });
  const plan = make().plan();
  const screen = removal.describePlan(plan).join('\n').split(removal.AGENT_LINE)[0];
  assert.match(screen, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: the Toolkit checkout, and 1 older backup file of Toolkit's own; it goes last/);
  assert.match(screen, /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*Your old Codex \.env:\*\* ~\/\.ai-agent-toolkit\/backups\/env-retire-2026-11-01T00-00-00-000Z: the file toolkit env moved there; it may be your only copy of its comment lines\n/);
  assert.match(screen, /- \*\*Key connection backups:\*\* ~\/\.ai-agent-toolkit\/backups\/env-feeders: the MCP settings toolkit env changed, which `toolkit env` can put back\n/);
  assert.match(screen, /- \*\*Memory tidy backups:\*\* ~\/\.ai-agent-toolkit\/backups\/memory-tidy: your memory notes from before a tidy, which memory tidy can put back\n/);
  const result = make().apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  for (const [file, text] of Object.entries(owned)) assert.equal(fs.readFileSync(path.join(folder, file), 'utf8'), text, file);
  assert.equal(fs.existsSync(path.join(folder, 'backups', 'global-rules')), false, "Toolkit's own older backups go");
  assert.equal(fs.existsSync(path.join(folder, 'source')), false);
  // The route the closing lines give (`setup toolkit`, then `toolkit env`) still finds the feeder backup.
  const { ClaudeCodeFeeder } = require('../scripts/toolkit-env-feeders.cjs');
  const restored = [];
  const feeder = new ClaudeCodeFeeder({ home, claudeJson: path.join(home, '.claude.json'), claudeCommand: 'claude-not-run', spawn: (...call) => { restored.push(call); return { status: 0, stdout: '', stderr: '' }; } });
  assert.doesNotThrow(() => { try { feeder.revoke({ harness: 'claude-code', server: 'github', name: 'GITHUB_TOKEN', backup: feederBackup }); } catch (error) { if (/backup[^\n]*missing/i.test(error.message)) throw error; } });
  assert.equal(make().plan().nothing, true, 'a second run finds nothing: the owner\'s backups are not Toolkit\'s to remove');
});

// G2 round 1 L1: the folded folder line names what actually goes.
test('the Toolkit folder: the folded line names only what goes', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  for (const file of ['backups/global-rules/2026-01-01T00-00-00-000Z/AGENTS.md', 'env/manifest.json']) { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), 'x'); }
  const plan = new removal.ToolkitRemoval({ home, parts: [new parts.ToolkitFolderPart({ home, plugins: () => ({}) })], plugins: () => ({}) }).plan();
  const line = removal.describePlan(plan).find(entry => entry.startsWith('- **Toolkit folder:**'));
  assert.equal(line, "- **Toolkit folder:** ~/.ai-agent-toolkit: 1 older backup file of Toolkit's own; it goes last, once no Toolkit plugin or Toolkit permission line is left");
});

// G2 round 1 L3: a one-app removal while another app keeps Toolkit gathers its own backup too, so a
// later last-app removal that saves none keeps the whole of it as the last removal's backup.
test('the Toolkit folder: a one-app removal gathers its backup, and a later removal that saves none keeps all of it', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  fs.mkdirSync(path.join(folder, 'source'), { recursive: true }); fs.writeFileSync(path.join(folder, 'source', 'x'), 'x');
  const installed = { 'claude-code': true, codex: true };
  let stamp = 0;
  const writer = { key: 'writer', title: 'Writer', app: 'codex', plan: () => (installed.codex ? [{ what: 'a Codex setting', action: 'remove', backup: true }] : []),
    apply: () => { for (const dir of ['global-rules', 'codex-delegation']) { const file = path.join(folder, 'backups', dir, `b${stamp}`, 'f.txt'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, dir); } stamp += 1; installed.codex = false; return [{ what: 'a Codex setting', result: 'removed' }]; } };
  const make = app => new removal.ToolkitRemoval({ home, app, parts: [writer, new parts.ToolkitFolderPart({ home, plugins: () => installed, now: () => new Date('2026-11-26T00:00:00Z') })], plugins: () => installed });
  const first = make('codex');
  const plan = first.plan();
  assert.equal(first.apply(plan.code).ok, true);
  assert.deepEqual(Object.keys(treeOf(path.join(folder, 'backups'))).sort(), [path.join('remove-toolkit', '2026-11-26T00-00-00-000Z', 'codex-delegation', 'b0', 'f.txt'), path.join('remove-toolkit', '2026-11-26T00-00-00-000Z', 'global-rules', 'b0', 'f.txt')].sort(), 'gathered although the folder stays for Claude Code');
  installed['claude-code'] = false;
  const last = make('all');
  const result = last.apply(last.plan().code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Object.keys(treeOf(path.join(folder, 'backups'))).length, 2, 'the last removal\'s backup stays whole');
});

// G2 round 1 M2: when the folder waits for a plugin that was not uninstalled, the closing lines say the
// folder stays and why, and say nothing that is no longer true (the MCP helper going, nothing left).
test('closing lines: a folder that waits for a plugin is named with its reason, and the MCP server keeps its key helper until then', t => {
  const home = s.tempHome(t);
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const script = path.join(home, '.ai-agent-toolkit', 'source', 'repo', 'scripts', 'toolkit-env.cjs');
  fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, '');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://example.test/mcp', headersHelper: `node "${script}" header GITHUB_TOKEN` } } }));
  const installed = { 'claude-code': true, codex: false };
  const make = () => { const folder = new parts.ToolkitFolderPart({ home, environment, plugins: () => installed }); return new removal.ToolkitRemoval({ home, parts: [folder, new parts.McpKeyHelpersPart({ environment, home, folder })], plugins: () => installed }); };
  const plan = make().plan();
  const result = make().apply(plan.code);
  assert.equal(result.folder_kept, true);
  const closing = removal.describeResult(result).join('\n').split(removal.AGENT_LINE)[0];
  assert.match(closing, /^\*\*Toolkit removal: the Toolkit folder stays for now\*\*\n/);
  assert.doesNotMatch(closing, /Nothing of Toolkit's was left to remove|which goes|Reconnect|New session/);
  assert.match(closing, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: the Claude Code plugin is still installed and reads its records there\n/);
  assert.match(closing, /- \*\*MCP servers:\*\* github \(Claude Code\): its key helper stays until the Toolkit folder goes\n/);
  assert.match(closing, /- \*\*Still to do:\*\* the Toolkit plugin is still installed in Claude Code, so the Toolkit folder stays\. Once it is uninstalled, say `remove toolkit` again to remove the folder/);
});

test('the Toolkit folder: an older backup that changes after the plan read is not deleted, and apply without its own plan read removes nothing', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  const file = path.join(folder, 'backups', 'claude-settings', 'a.json');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'old');
  const part = new parts.ToolkitFolderPart({ home, plugins: () => ({}) });
  assert.throws(() => part.apply([{ what: '~/.ai-agent-toolkit/backups', action: 'remove' }]), /not read before its removal/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  const items = part.plan();
  fs.writeFileSync(file, 'rewritten after the plan');
  part.apply(items);
  // A file that changed is this removal's own: it is gathered, never deleted.
  assert.deepEqual(Object.values(treeOf(folder)), [Buffer.from('rewritten after the plan').toString('hex')]);
});

// Rules for the harnesses the removal asks for, so a one-app removal is seen to leave the other app's file.
function scopedRules() {
  const asked = [];
  const states = { 'claude-code': 'current', codex: 'current', antigravity: 'current' };
  const factory = (only = null) => {
    asked.push(only);
    const harnesses = only || Object.keys(states);
    const files = () => harnesses.map(harness => ({ harness, file: `~/${harness}/rules.md`, display: `~/${harness}/rules.md`, state: states[harness] }));
    return { check: () => ({ files: files() }),
      remove() { const out = files().map(file => ({ ...file, action: file.state === 'current' ? 'removed' : 'absent' })); for (const harness of harnesses) states[harness] = 'absent'; return { files: out }; } };
  };
  return { factory, asked, states };
}

test('removal from Codex only, while Claude Code keeps Toolkit: nothing of Claude Code or shared is touched', t => {
  const h = fullHome(t);
  h.installed.codex = true;
  const w = { home: h.home, scheduler: s.fakeScheduler() };
  const task = enrol(t, w, 'widget');
  const rules = scopedRules();
  const make = () => h.make({ app: 'codex', scheduler: w.scheduler, rules: rules.factory });
  const plan = make().plan();
  const text = removal.describePlan(plan).join('\n');
  assert.equal(plan.app, 'codex');
  assert.deepEqual(plan.kept_for, ['claude-code']);
  assert.deepEqual(plan.plugins, ['codex'], 'only the Codex plugin lines');
  assert.deepEqual(plan.tasks, [], 'scheduled tasks serve every app, so they stay');
  assert.equal(plan.scheduler, 'kept for another app');
  assert.deepEqual(plan.rules.map(file => file.harness), ['codex'], "only Codex's global rules file");
  // Antigravity's file is only read, so the kept line can name it.
  assert.deepEqual(rules.asked, [['codex'], ['antigravity']]);
  assert.match(text, /\*\*From:\*\* Codex only\.\n/);
  assert.match(text, /^- \*\*Shared parts:\*\* old scheduled tasks from an earlier Toolkit with their files, Antigravity's global rules and the Toolkit folder stay, because Claude Code still has the Toolkit plugin$/m);
  assert.match(text, /- \*\*Helper agents:\*\* ~\/\.codex\/agents\/toolkit-g1\.toml\n/);
  assert.match(text, /- \*\*Codex helper limit:\*\* /);
  assert.doesNotMatch(text, /\.claude\/|claude plugin|Claude Code subagent limit|\*\*Toolkit folder:\*\*|MCP servers/);
  const result = make().apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.depth.inspect().state, 'toolkit-one-layer', "Claude Code's subagent limit stays");
  assert.ok(fs.existsSync(path.join(h.agents.claude, 'toolkit-g0.md')), "Claude Code's helper file stays");
  assert.deepEqual(fs.readdirSync(h.agents.codex), []);
  assert.ok(fs.readdirSync(path.join(h.home, '.claude', 'skills')).length > 1, "Claude Code's skill copies stay");
  assert.ok(fs.existsSync(path.join(h.folder, 'source', 'repo', 'README.md')), 'the Toolkit folder stays');
  assert.ok(task.live(), 'the scheduled task stays');
  assert.deepEqual(rules.states, { 'claude-code': 'current', codex: 'absent', antigravity: 'current' });
  assert.equal(h.delegation.calls.length, 1);
});

test('removal from Codex only, with no other app keeping Toolkit: the shared parts go too, never Claude Code\'s own', t => {
  const h = fullHome(t);
  h.installed['claude-code'] = false;
  const rules = scopedRules();
  const plan = h.make({ app: 'codex', rules: rules.factory }).plan();
  assert.deepEqual(plan.kept_for, []);
  assert.deepEqual(rules.asked, [['codex', 'antigravity']]);
  const text = removal.describePlan(plan).join('\n');
  assert.match(text, /- \*\*Toolkit folder:\*\* ~\/\.ai-agent-toolkit: [^\n]*it goes last, once no Toolkit plugin or Toolkit permission line is left/);
  assert.match(text, /\*\*From:\*\* Codex only; no other app has the Toolkit plugin, so the shared parts below go too\./);
  assert.doesNotMatch(text, /\.claude\/agents|Claude Code subagent limit|\.claude\/skills/);
});

test('full removal: a Claude Code subagent limit you set yourself is listed as kept and left alone', t => {
  const h = fullHome(t);
  const file = path.join(h.environment.CLAUDE_CONFIG_DIR, 'settings.json');
  fs.writeFileSync(file, '{\n  "env": {\n    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "3"\n  }\n}\n');
  const plan = h.make().plan();
  assert.match(removal.describePlan(plan).join('\n'), /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*Claude Code subagent limit:\*\* CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH in ~\/\.claude\/settings\.json: your own value\n/);
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
  assert.match(removal.describePlan(plan).join('\n'), /\*\*Kept\*\*\n- \*\*Broken part:\*\* Broken part: left alone, could not be read \(unreadable\)/);
});

// ---- What Toolkit added after the first removal: Codex's setup record, the update reports, the
// recovery records' label, Claude Code's own settings and the n8n Skills plugin left as they are ----
const { CodexSetupJournal } = require('../scripts/setup-codex-toolkit-plugin.cjs');

// A home with Codex's setup journal in the given state ('completed', an unfinished step, or unreadable
// bytes), Toolkit's update reports beside a file of the owner's in a temp folder, and a removal over
// just those parts.
function recordsHome(t, { journal = 'completed', installed = { 'claude-code': false, codex: false } } = {}) {
  const home = s.tempHome(t);
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const journalFile = new CodexSetupJournal(environment.CODEX_HOME).path;
  fs.mkdirSync(environment.CODEX_HOME, { recursive: true });
  if (journal !== null) fs.writeFileSync(journalFile, journal === 'unreadable' ? '{not json' : JSON.stringify({ status: journal, step: 'marketplace-add' }));
  const reportDir = path.join(home, 'AppData', 'Local', 'Temp', 'ai-agent-toolkit', 'update-reports');
  fs.mkdirSync(reportDir, { recursive: true });
  for (const name of ['toolkit-update-20261120-101500.md', 'toolkit-update-20261120-101500-2.md']) fs.writeFileSync(path.join(reportDir, name), '# report\n');
  const isReport = file => require('../scripts/toolkit-local-bridge.cjs').isUpdateReportPath(file, { reportDir });
  const list = [new parts.CodexSetupJournalPart({ environment, home }), new parts.UpdateReportsPart({ environment, home, reportDir, isReport, plugins: () => installed })];
  const make = (options = {}) => new removal.ToolkitRemoval({ home, parts: list, plugins: () => installed, ...options });
  return { home, environment, journalFile, reportDir, installed, make };
}

const itemsOf = (plan, key) => plan.parts.find(part => part.key === key)?.items || [];

// One row per scope and state: [journal state, --app, plan action for the journal ('none' when not listed)].
const JOURNAL_ROWS = [
  ['completed', 'codex', 'remove'], ['completed', 'all', 'remove'], ['completed', 'claude-code', 'none'],
  ['in-progress', 'codex', 'keep'], ['in-progress', 'all', 'keep'], ['unreadable', 'all', 'keep'], [null, 'all', 'none'],
];
for (const [journal, app, expected] of JOURNAL_ROWS) {
  test(`Codex setup record: a ${journal === null ? 'missing' : journal} journal with --app ${app} is ${expected === 'none' ? 'not listed' : expected === 'remove' ? 'removed' : 'kept as evidence'}`, t => {
    const h = recordsHome(t, { journal });
    const before = journal === null ? null : fs.readFileSync(h.journalFile);
    const plan = h.make({ app }).plan();
    const items = itemsOf(plan, 'codex_setup_journal');
    assert.deepEqual(items.map(item => item.action), expected === 'none' ? [] : [expected]);
    const text = removal.describePlan(plan).join('\n');
    if (expected === 'remove') assert.match(text, /\*\*Removed\*\*\n(- [^\n]+\n)*- \*\*Codex setup record:\*\* ~\/\.codex\/ai-agent-toolkit-setup-journal\.json\n/);
    if (expected === 'keep') assert.match(text, /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*Codex setup record:\*\* ~\/\.codex\/ai-agent-toolkit-setup-journal\.json: it records a setup step that did not finish or cannot be read, so it stays as the evidence of what was attempted/);
    const result = h.make({ app }).apply(plan.code);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (expected === 'remove') assert.equal(fs.existsSync(h.journalFile), false);
    else if (before) assert.deepEqual(fs.readFileSync(h.journalFile), before, 'the journal stays byte for byte');
    assert.equal(h.make({ app }).plan().parts.some(part => part.items.some(item => item.action === 'remove' && part.key === 'codex_setup_journal')), false, 'a second plan has no journal to remove');
  });
}

test('Codex setup record: a step that starts after the plan keeps the journal', t => {
  const h = recordsHome(t);
  const part = new parts.CodexSetupJournalPart({ environment: h.environment, home: h.home });
  const planned = part.plan();
  fs.writeFileSync(h.journalFile, JSON.stringify({ status: 'in-progress', step: 'plugin-add' }));
  assert.deepEqual(part.apply(planned).map(item => item.result), ['kept']);
  assert.ok(fs.existsSync(h.journalFile));
});

// [another app keeps Toolkit, a plugin still installed at apply, expected report result].
const REPORT_ROWS = [
  ['all apps, no plugin left', { app: 'all', installed: {} }, 'removed'],
  ['all apps, a plugin still installed', { app: 'all', installed: { 'claude-code': true } }, 'kept'],
  ['Codex only, while Claude Code keeps Toolkit', { app: 'codex', installed: { 'claude-code': true } }, 'not listed'],
  ['Codex only, no other app keeps Toolkit', { app: 'codex', installed: {} }, 'removed'],
];
for (const [name, { app, installed }, expected] of REPORT_ROWS) {
  test(`update reports: ${name}: ${expected}`, t => {
    const h = recordsHome(t, { installed: { 'claude-code': false, codex: false, ...installed } });
    const plan = h.make({ app }).plan();
    const items = itemsOf(plan, 'update_reports');
    assert.deepEqual(items.map(item => item.action), expected === 'not listed' ? [] : ['remove']);
    if (items.length) assert.match(removal.describePlan(plan).join('\n'), /- \*\*Update reports:\*\* ~\/AppData\/Local\/Temp\/ai-agent-toolkit\/update-reports \(Toolkit's report files; any other file there stays\)/);
    const result = h.make({ app }).apply(plan.code);
    assert.equal(result.ok, true, JSON.stringify(result));
    const left = fs.existsSync(h.reportDir) ? fs.readdirSync(h.reportDir).sort() : null;
    if (expected === 'removed') {
      assert.equal(left, null, 'the folder goes once empty');
      assert.equal(fs.existsSync(path.dirname(h.reportDir)), false, 'and its ai-agent-toolkit parent');
    } else assert.equal(left.length, 2, 'the reports stay');
    if (expected === 'kept') assert.match(removal.describeResult(result).join('\n'), /- \*\*Update reports:\*\* ~\/AppData\/Local\/Temp\/ai-agent-toolkit\/update-reports: the Claude Code plugin is still installed and writes its reports there/);
  });
}

test('update reports: a file that is not a Toolkit report stays, with its folder', t => {
  const h = recordsHome(t);
  fs.writeFileSync(path.join(h.reportDir, 'my-notes.md'), 'mine\n');
  const plan = h.make().plan();
  const result = h.make().apply(plan.code);
  assert.deepEqual(fs.readdirSync(h.reportDir), ['my-notes.md']);
  assert.match(removal.describeResult(result).join('\n'), /update-reports: it still holds files that are not Toolkit reports/);
});

test('the default parts include the Codex setup record and the update reports before the Toolkit folder, and only the MCP report after it', () => {
  const keys = parts.defaultParts({ environment: { CLAUDE_CONFIG_DIR: '/x/.claude', CODEX_HOME: '/x/.codex' }, home: '/x' }).map(part => part.key);
  assert.ok(keys.includes('codex_setup_journal'));
  assert.ok(keys.indexOf('update_reports') < keys.indexOf('toolkit_folder'));
  assert.deepEqual(keys.slice(-2), ['toolkit_folder', 'mcp_key_helpers']);
});

test('the Toolkit folder: recovery records and the key list are kept, never called someone else\'s file', t => {
  const home = s.tempHome(t);
  const folder = path.join(home, '.ai-agent-toolkit');
  for (const file of ['recovery-identities/r.json', 'env/manifest.json']) { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), '{}'); }
  const part = new parts.ToolkitFolderPart({ home, plugins: () => ({}) });
  const items = part.plan();
  assert.deepEqual(items, [
    { what: '~/.ai-agent-toolkit/env', action: 'keep', label: 'Your key list', detail: 'the keys themselves stay in the credential store' },
    { what: '~/.ai-agent-toolkit/recovery-identities', action: 'keep', label: 'Recovery records', detail: 'the evidence of outside resources checked before a live change' },
  ]);
  part.apply(items);
  assert.ok(fs.existsSync(path.join(folder, 'recovery-identities', 'r.json')));
  assert.ok(fs.existsSync(path.join(folder, 'env', 'manifest.json')));
});

test('Claude Code settings setup turned on stay byte for byte, and the n8n Skills plugin gets no step', t => {
  const h = fullHome(t);
  const settingsFile = path.join(h.environment.CLAUDE_CONFIG_DIR, 'settings.json');
  const { ClaudeUserSettings } = require('../scripts/toolkit-claude-user-settings.cjs');
  const control = path.join(h.home, '.ai-agent-toolkit', 'agent-control');
  const settings = new ClaudeUserSettings({ environment: h.environment, controlRoot: control });
  settings.apply('enable');
  // Setup's subagent limit is Toolkit's own value, not a Claude Code setting the owner keeps: it is the
  // one settings write removal makes. Taken off first so the file can be compared byte for byte.
  assert.equal(h.depth.apply('disable').changed, true);
  const set = settings.inspect().filter(entry => entry.state === 'toolkit-value').map(entry => entry.id);
  assert.ok(set.length >= 2, `setup turned on ${set.join(', ')}`);
  // The n8n Skills plugin as setup turned it off; Toolkit no longer manages it, so removal leaves it so.
  const pluginsFile = path.join(h.environment.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json');
  fs.mkdirSync(path.dirname(pluginsFile), { recursive: true });
  fs.writeFileSync(pluginsFile, JSON.stringify({ plugins: { 'n8n-skills@n8n-io': [{ scope: 'user' }] } }));
  const before = { settings: fs.readFileSync(settingsFile), plugins: fs.readFileSync(pluginsFile) };
  const plan = h.make().plan();
  const text = removal.describePlan(plan).join('\n');
  const line = text.split('\n').find(entry => entry.startsWith('- **Claude Code settings from setup:** '));
  assert.match(line, /: Claude Code's own settings, so they stay as they are; change them in ~\/\.claude\/settings\.json$/);
  for (const id of set.filter(entry => entry !== 'attribution')) assert.ok(line.includes(`(${id})`), id);
  assert.ok(set.includes('attribution'));
  assert.doesNotMatch(line, /\(attribution\)/);
  assert.ok(text.includes('\n- **No AI credit in commits:** a Claude Code setting setup turned on; change it in ~/.claude/settings.json\n'));
  assert.doesNotMatch(text, /n8n-skills@|plugin enable|preferences you chose/);
  assert.match(text, /\*\*Never touched\*\*\n- Your repositories, your keys \(in the credential store\), other plugins, and every setting, agent, skill and file you made yourself\./);
  assert.match(removal.describePlan(plan, { full: true }).join('\n'), /- \*\*Skill copies:\*\*\n(  - [^\n]+\n)*  - ~\/\.claude\/skills\/n8n-/, 'the copied n8n skills go');
  const result = h.make().apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(fs.readFileSync(settingsFile), before.settings, 'settings.json is byte for byte as it was');
  assert.deepEqual(fs.readFileSync(pluginsFile), before.plugins, 'the n8n Skills plugin is left as it is');
  assert.equal(fs.readdirSync(path.join(h.home, '.claude', 'skills')).some(name => name.startsWith('n8n-')), false);
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
  // The description as hosts show it, without its YAML quotes.
  const description = parseFrontMatter(skill).description;
  assert.ok(description.length <= 1024, `description ${description.length} characters`);
  // Codex desktop lists each skill with only about the first 200 characters of its description, so the
  // remove route has to sit inside them (a 13 November Codex session showed this skill cut at 203).
  const shown = description.slice(0, 195);
  assert.match(shown, /`remove toolkit` \(full uninstall: `toolkit-remove\.cjs plan` first, never the app's uninstall alone\)/);
  const section = skill.split('## Remove Toolkit from this computer')[1].split('\n## ')[0];
  assert.match(section, /Do this even when the app offers its own plugin uninstall tool \(such as Codex's `uninstall_plugin`\) or the plugin is already gone/);
  assert.match(section, /an app's own uninstall tool may do this step for that app/);
  assert.ok(section.indexOf('toolkit-remove.cjs plan') < section.indexOf('Only after a yes'), 'the plan comes before any uninstall');
  // The owner picks the scope: Codex's remove once reached into Claude Code without asking.
  assert.match(section, /first ask the user whether to remove Toolkit from only this app \(the one you run in\) or from every app on this computer; never pick for them/);
  assert.ok(section.indexOf('every app on this computer') < section.indexOf('toolkit-remove.cjs plan --app'), 'the scope question comes before the plan');
  assert.match(section, /`apply --confirm <plan code> --app <the same app>`/);
  // The app's own uninstall tool is allowed only as a step after the user's yes, never before the plan is shown.
  const afterYes = section.slice(section.indexOf('Only after a yes'));
  assert.equal(section.split("an app's own uninstall tool may do this step").length, 2, 'the allowance appears once');
  assert.match(afterYes.split('. ')[0], /an app's own uninstall tool may do this step for that app/, 'the allowance sits in the step after the yes');
  // Owner test of 26 Nov 2026 ("why code block though"): the plan is shown as ordinary text, and only
  // what sits above the agent's own steps, whose first line the skill names exactly.
  assert.ok(section.includes(`above its \`${removal.AGENT_LINE}\` line exactly as printed, as ordinary text, never in a code block`));
  assert.match(section, /Show apply's closing lines the same way/);
  // G2 1543 L4: the shared parts are old tasks from an earlier Toolkit, and the folder keeps only the key list,
  // the recovery records and this removal's backup.
  assert.doesNotMatch(section, /the scheduled tasks, Antigravity's copies|keeping `env` and the backups/);
  assert.match(section, /old scheduled tasks from an earlier Toolkit, Antigravity's copies, the update reports and the Toolkit folder/);
});

// The legacy cleaner's own guards. The fake scheduler above stands in for Task Scheduler, so these
// read the real PowerShell scripts and the checks that run before PowerShell starts.
test('legacy cleaner: unregister removes the exact task object only while it still carries the marker and matches the plan', () => {
  const script = windows.SCRIPTS.unregister;
  assert.match(script, /IndexOf\(\$p\.marker\) -lt 0\) \{ throw/);
  assert.match(script, /expected_xml[\s\S]*Task changed before removal/);
  assert.match(script, /Export-ScheduledTask -InputObject \$t\[0\]/);
  assert.match(script, /Unregister-ScheduledTask -InputObject \$t\[0\] -Confirm:\$false/);
  assert.doesNotMatch(script, /-TaskName \$p\.name/);
});

test('legacy cleaner: a folder goes only when it holds no task and no subfolder', () => {
  assert.match(windows.SCRIPTS['remove-folder'], /GetTasks\(1\)\.Count -eq 0 -and \$f\.GetFolders\(0\)\.Count -eq 0/);
});

test('legacy cleaner: list reads every field the exact-match removal compares, with the exported XML', () => {
  const script = windows.SCRIPTS.list;
  assert.match(script, /\$actions = @\(\$t\.Actions/);
  for (const field of ['EndBoundary', 'WeeksInterval', 'DaysInterval', 'StopAtDurationEnd', 'RunLevel', 'ExecutionTimeLimit']) assert.ok(script.includes(field), field);
  assert.match(script, /definition_xml = \(Export-ScheduledTask -TaskPath \$path -TaskName \$t\.TaskName\)/);
});

test('legacy cleaner: a bad task name or folder is refused before any PowerShell call', () => {
  const spawned = [];
  const scheduler = windows.powerShellScheduler({ run: (...args) => { spawned.push(args); return { status: 0, stdout: '{"removed":true}' }; } });
  for (const name of ['TOOLKIT: SWEEP', 'TOOLKIT - SWEEP ', ' TOOLKIT', 'A/B', 'A\\B', 'A*B', 'A?B', 'A"B', 'A<B', 'A>B', 'A|B', '.', '..'])
    assert.throws(() => scheduler.unregister('TOOLKIT', name, 'demo', { definition_xml: '<Task/>' }), /task name/, name);
  for (const folder of ['toolkit', '-X', 'A B', 'A'.repeat(33), '..']) assert.throws(() => scheduler.list(folder), /folder/, folder);
  assert.deepEqual(spawned, []);
  assert.deepEqual(scheduler.unregister('TOOLKIT', 'TOOLKIT - PROGRAMME SWEEP', 'demo', { definition_xml: '<Task/>' }), { removed: true });
  assert.equal(spawned.length, 1);
});

test('legacy cleaner: a native denial is reported after one attempt', () => {
  let attempts = 0;
  const scheduler = windows.powerShellScheduler({ run: () => { attempts += 1; return { status: 1, stderr: 'Access is denied' }; } });
  assert.throws(() => scheduler.list('TOOLKIT'), /Access is denied/);
  assert.equal(attempts, 1);
});

// An earlier release's apply recorded the task's exported XML with its definition. The cleaner must
// compare that XML: without it, an unchanged task reads as changed, and a late XML edit goes unseen.
function withExportedXml(w, e, xml = '<Task version="1.4"><Actions><Exec/></Actions></Task>') {
  e.live().definition_xml = xml;
  tasks.updateRegistry(w.home, list => list.map(entry => entry.id === e.entry.id ? { ...entry, enrolled: { ...entry.enrolled, definition_xml: xml } } : entry));
}

test('a task recorded with its exported XML, still unchanged, is planned as Toolkit\'s own and removed', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  withExportedXml(w, e);
  const plan = owner(w).plan();
  assert.deepEqual(plan.tasks.map(item => [item.kind, item.action]), [['toolkit', 'remove']]);
  assert.equal(owner(w).apply(plan.code).ok, true);
  assert.equal(e.live(), undefined);
});

test('a task whose exported XML alone changes between the plan read and its removal is left alone', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  withExportedXml(w, e);
  const plan = owner(w).plan();
  const list = w.scheduler.list.bind(w.scheduler);
  let reads = 0;
  // The first list call belongs to apply's own fresh plan; only the XML changes just after it.
  w.scheduler.list = folder => { const rows = list(folder); if (++reads === 1) e.live().definition_xml = '<Task version="1.4"><Actions><Exec>late</Exec></Actions></Task>'; return rows; };
  const result = owner(w).apply(plan.code);
  assert.equal(result.ok, false);
  assert.match(result.tasks[0].reason, /changed after the plan was read/);
  assert.ok(e.live());
  assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id));
});

test('a task whose exported XML alone was edited by hand is planned as changed and kept, and apply removes nothing', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  withExportedXml(w, e);
  // Every structured field still matches the record; only the exported XML differs.
  e.live().definition_xml = '<Task version="1.4"><Actions><Exec>hand edit</Exec></Actions></Task>';
  const plan = owner(w).plan();
  assert.deepEqual(plan.tasks.map(item => [item.kind, item.action]), [['changed', 'keep']]);
  const result = owner(w).apply(plan.code);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(w.scheduler.calls.filter(call => call[0].startsWith('unregister')), []);
  assert.ok(e.live());
  assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id));
  assert.equal(fs.existsSync(windows.runnersDir(w.home)), true, 'a kept marked task keeps the shared runner');
});

// A secret-shaped value, built at run time so none sits in this file.
const secret = () => ['gh', 'p_', 'A1b2C3d4E5'.repeat(4)].join('');

// The task record's own guards (toolkit-tasks.cjs). The record is written by hand here, so each test
// shows one guard on its own.
test.describe('the task record\'s own guards', () => {
  const entry = (extra = {}) => ({ id: 'demo-sweep', name: 'DEMO - SWEEP', host: 'windows', folder: 'DEMO', schedule: 'hourly', model: null, effort: null,
    purpose: 'Removes the footer.', repository: 'example/demo', created: '2026-10-29T00:00:00.000Z', created_by: 'toolkit-windows-tasks apply', ...extra });
  const record = (home, list) => {
    fs.mkdirSync(path.dirname(tasks.registryPath(home)), { recursive: true });
    fs.writeFileSync(tasks.registryPath(home), JSON.stringify({ schema: 'toolkit.tasks.v1', tasks: list }));
  };
  const readWith = (t, extra) => { const home = s.tempHome(t); record(home, [entry(extra)]); return tasks.readRegistry(home); };

  test('the plain entry these tests start from reads as ok', t => {
    assert.equal(readWith(t, {}).status, 'ok');
    assert.equal(readWith(t, { checkout: 'C:\\GitHub\\demo', toolkit_root: 'C:\\Toolkit', stopped_by_owner: true, stopped_at: '2026-11-15T00:00:00.000Z' }).status, 'ok');
  });

  test('safeText replaces a secret-shaped line, and a plan part failing with one shows only the replacement', t => {
    assert.equal(tasks.safeText(`login failed for ${secret()}`), '[removed: looked like a secret]');
    assert.equal(tasks.safeText('plain\nreason'), 'plain reason');
    const broken = { key: 'broken', title: 'Broken part', plan() { throw new Error(`token ${secret()} rejected`); }, apply() { throw new Error('must not run'); } };
    const shown = removal.describePlan(new removal.ToolkitRemoval({ home: s.tempHome(t), parts: [broken] }).plan()).join('\n');
    assert.match(shown, /Broken part: left alone, could not be read \(\[removed: looked like a secret\]\)/);
    assert.equal(shown.includes(secret()), false);
  });

  test('an entry holding a secret-shaped value makes the record unreadable, and is never written', t => {
    for (const extra of [{ purpose: `uses ${secret()}` }, { job: secret() }, { enrolled_note: { inner: secret() } }])
      assert.deepEqual(readWith(t, extra), { status: 'unreadable', reason: 'an entry has a bad secret-shaped value' }, JSON.stringify(Object.keys(extra)));
    const home = s.tempHome(t);
    assert.throws(() => tasks.writeRegistry(home, [entry({ job: secret() })]), { name: 'TasksError', message: /refused to record a task with a bad secret-shaped value/ });
    assert.equal(fs.existsSync(tasks.registryPath(home)), false);
  });

  test('the record is written with mode 600', { skip: process.platform === 'win32' ? 'Windows keeps no POSIX mode; the file is in the user profile' : false }, t => {
    // A loose umask, so the 600 comes from the write itself.
    const umask = process.umask(0o022);
    t.after(() => process.umask(umask));
    const home = s.tempHome(t);
    tasks.writeRegistry(home, [entry()]);
    assert.equal(fs.statSync(tasks.registryPath(home)).mode & 0o777, 0o600);
    tasks.updateRegistry(home, list => list);
    assert.equal(fs.statSync(tasks.registryPath(home)).mode & 0o777, 0o600, 'a rewrite keeps it');
  });

  test('a checkout or toolkit_root that is relative or holds a quote or control character makes the record unreadable', t => {
    for (const key of ['checkout', 'toolkit_root'])
      for (const value of ['GitHub\\demo', 'C:\\Git"Hub', 'C:\\Git\u0007Hub', 'C:\\Git\u2028Hub', 42])
        assert.deepEqual(readWith(t, { [key]: value }), { status: 'unreadable', reason: `an entry has a bad ${key}` }, `${key}=${JSON.stringify(value)}`);
  });

  test('stopped_by_owner and stopped_at come together, and stopped_at is an exact UTC time', t => {
    for (const extra of [{ stopped_by_owner: true }, { stopped_at: '2026-11-15T00:00:00.000Z' }, { stopped_by_owner: true, stopped_at: '2026-11-15' }, { stopped_by_owner: true, stopped_at: '2026-13-45T00:00:00.000Z' }])
      assert.deepEqual(readWith(t, extra), { status: 'unreadable', reason: 'an entry has a bad stopped_at' }, JSON.stringify(extra));
  });

  test('updateRegistry refuses a record it could not read and leaves it byte for byte', t => {
    const home = s.tempHome(t);
    fs.mkdirSync(path.dirname(tasks.registryPath(home)), { recursive: true });
    fs.writeFileSync(tasks.registryPath(home), '{broken');
    let called = false;
    assert.throws(() => tasks.updateRegistry(home, list => { called = true; return list; }), { name: 'TasksError', message: /could not be read \(not valid JSON\), so nothing was recorded/ });
    assert.equal(called, false);
    assert.equal(fs.readFileSync(tasks.registryPath(home), 'utf8'), '{broken');
  });
});

// What Windows PowerShell wrote to stderr on the owner's computer before anything else: a CLIXML
// progress block ("Preparing modules for first use.").
const CLIXML_PROGRESS = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>';

test('a PowerShell failure gives the first real stderr line, past the CLIXML block Windows PowerShell writes first', () => {
  const shapes = {
    'after the block': `${CLIXML_PROGRESS}\r\nAccess is denied.\r\nmore detail\r\n`,
    'inside the block': `${CLIXML_PROGRESS.replace('</Objs>', '')}Access is denied.\r\n</Objs>`,
    'as an error record': '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">Access is denied._x000D__x000A_</S><S S="Error">more detail_x000D__x000A_</S></Objs>',
    'with no block': 'Access is denied.\nmore detail',
  };
  for (const [name, stderr] of Object.entries(shapes)) {
    assert.equal(windows.stderrMessage(stderr), 'Access is denied.', name);
    assert.throws(() => windows.powerShellScheduler({ run: () => ({ status: 1, stderr }) }).list('TOOLKIT'), { name: 'WindowsTasksError', message: 'Access is denied.' }, name);
  }
  // A block with nothing after it, or no stderr at all, names the operation.
  for (const stderr of [CLIXML_PROGRESS, '', undefined])
    assert.throws(() => windows.powerShellScheduler({ run: () => ({ status: 1, stderr }) }).list('TOOLKIT'), { message: 'PowerShell list failed' });
});

test('remove toolkit names a Task Scheduler error inside the plain line, screened for secrets, and any other error gets the plain line alone', t => {
  const run = scheduler => { const out = [], err = []; const code = removal.main(['plan', '--app', 'all'], { home: s.tempHome(t), scheduler, rules: null, parts: [], plugins: () => ({}), log: line => out.push(line), error: line => err.push(line) }); return { code, err: err.join('\n') }; };
  const denied = stderr => windows.powerShellScheduler({ run: () => ({ status: 1, stderr }) });
  for (const stderr of [`${CLIXML_PROGRESS}\r\nAccess is denied.\r\n`, 'Access is denied.\nmore detail'])
    assert.deepEqual(run(denied(stderr)), { code: 1, err: 'Toolkit removal could not be planned (Access is denied.); nothing was removed.' });
  assert.deepEqual(run(denied(CLIXML_PROGRESS)), { code: 1, err: 'Toolkit removal could not be planned (PowerShell marked-folders failed); nothing was removed.' });
  assert.deepEqual(run(denied(`denied for ${secret()}`)), { code: 1, err: 'Toolkit removal could not be planned ([removed: looked like a secret]); nothing was removed.' });
  const plain = { markedFolders() { throw new Error('internal detail'); }, list() { return []; } };
  assert.deepEqual(run(plain), { code: 1, err: 'Toolkit removal could not be planned; nothing was removed.' });
});

// The Claude desktop app's Toolkit copy from the claude.ai account, as the app keeps it under
// LOCALAPPDATA: an account-plugin folder whose manifest names the plugin and its folder.
function accountCopy(home, { name = 'ai-agent-toolkit' } = {}) {
  const local = path.join(home, 'AppData', 'Local');
  const folder = path.join(local, 'Claude-Data', 'claude_pkg', 'rpm', 'acct', 'org');
  fs.mkdirSync(path.join(folder, 'plugin_01abc', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ plugins: [{ name, id: 'plugin_01abc' }] }));
  fs.writeFileSync(path.join(folder, 'plugin_01abc', '.claude-plugin', 'plugin.json'), '{"version":"3.181.2"}');
  return { environment: { LOCALAPPDATA: local }, copy: path.join(folder, 'plugin_01abc') };
}

// Owner test of 25 Nov 2026: the Claude app runs the account copy, which `remove toolkit` never named,
// so after a yes the app could keep running Toolkit's hooks.
for (const [app, listed] of [['claude-code', true], ['all', true], ['codex', false]]) {
  test(`the Claude app's account copy, --app ${app}: ${listed ? 'listed as kept with its own removal steps' : 'not listed'}, and never changed`, t => {
    const home = s.tempHome(t);
    const { environment, copy } = accountCopy(home);
    const before = treeOf(copy);
    const make = () => new removal.ToolkitRemoval({ home, app, parts: [new parts.ClaudeAccountCopyPart({ environment, home })], plugins: () => ({}) });
    const plan = make().plan();
    const items = itemsOf(plan, 'claude_account_copy');
    assert.deepEqual(items.map(item => item.action), listed ? ['keep'] : []);
    const text = removal.describePlan(plan).join('\n');
    if (listed) {
      assert.match(text, /\*\*Kept\*\*\n(- [^\n]+\n)*- \*\*The Claude app's claude\.ai copy:\*\* only claude\.ai can remove it/);
      assert.match(text, /removes Toolkit from the Claude app on every computer and cloud session signed in to that account/);
      assert.match(text, /Until then the Claude app keeps running Toolkit's hooks from it/);
      assert.match(text, /on claude\.ai in a web browser, open Customize > Plugins and remove the ai-agent-toolkit plugin and then its marketplace \(while the marketplace stays, Sync automatically can put the plugin back\), then fully quit and reopen the Claude app/);
    } else assert.doesNotMatch(text, /claude\.ai/);
    const result = make().apply(plan.code);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(treeOf(copy), before, 'the account copy is never changed');
    const after = removal.describeResult(result).join('\n');
    if (listed) {
      // The owner's change: the full explanation only on the first plan; one line on every later screen.
      const short = "- **The Claude app's claude.ai copy:** remove it on claude.ai under Customize > Plugins (plugin, then marketplace), then restart the app";
      assert.ok(after.includes(`${short}\n`), after);
      assert.doesNotMatch(after, /only claude\.ai can remove it/);
      assert.ok(removal.describePlan(plan, { full: true }).includes(short));
      assert.doesNotMatch(removal.describePlan(plan, { full: true }).join('\n'), /only claude\.ai can remove it/);
      assert.match(after, /- \*\*The Claude app:\*\* it still runs Toolkit from your claude\.ai account until you remove it there \(the step is above\)/);
    } else assert.doesNotMatch(after, /claude\.ai/);
  });
}

test('the Claude app account copy: no app folder, or no Toolkit in it, lists nothing', t => {
  const home = s.tempHome(t);
  assert.deepEqual(new parts.ClaudeAccountCopyPart({ environment: { LOCALAPPDATA: path.join(home, 'AppData', 'Local') }, home }).plan(), []);
  assert.deepEqual(new parts.ClaudeAccountCopyPart({ environment: {}, home }).plan(), []);
  const other = accountCopy(home, { name: 'someone-elses-plugin' });
  assert.deepEqual(new parts.ClaudeAccountCopyPart({ environment: other.environment, home }).plan(), []);
});

test('the default parts include the Claude app account copy', () => {
  const keys = parts.defaultParts({ environment: { CLAUDE_CONFIG_DIR: '/x/.claude', CODEX_HOME: '/x/.codex' }, home: '/x' }).map(part => part.key);
  assert.ok(keys.includes('claude_account_copy'));
});

// Owner test of 25 Nov 2026: "Kept, because Codex still has Toolkit: the scheduled tasks and their files"
// on a computer with no scheduled tasks. The scope line names only the shared parts that are there.
test('a one-app removal names only the shared parts that are there: no scheduled tasks, no line about them', t => {
  const h = fullHome(t);
  h.installed.codex = true;
  const rules = scopedRules();
  rules.states.antigravity = 'absent';
  const kept = removal.describePlan(h.make({ app: 'claude-code', scheduler: s.fakeScheduler(), rules: rules.factory }).plan()).join('\n');
  assert.match(kept, /^- \*\*Shared parts:\*\* the Toolkit folder stays, because Codex still has the Toolkit plugin$/m);
  assert.doesNotMatch(kept, /scheduled task|Antigravity/);
  h.installed.codex = false;
  const goes = removal.describePlan(h.make({ app: 'claude-code', scheduler: s.fakeScheduler(), rules: rules.factory }).plan()).join('\n');
  assert.match(goes, /^\*\*From:\*\* Claude Code only; no other app has the Toolkit plugin, so the shared parts below go too\.$/m);
  assert.doesNotMatch(goes, /scheduled task|Antigravity|Shared parts/);
});

test('a one-app removal with nothing shared on the computer has no shared line at all', t => {
  const home = s.tempHome(t);
  for (const installed of [{ codex: true }, {}]) {
    const text = removal.describePlan(new removal.ToolkitRemoval({ home, app: 'claude-code', scheduler: s.fakeScheduler(), parts: [], plugins: () => installed }).plan()).join('\n');
    assert.doesNotMatch(text, /Shared parts|shared parts below go too/);
    assert.match(text, /^\*\*From:\*\* Claude Code only\.$/m);
  }
});

// Only true lines: the Never touched line is fixed and true for every removal; the Claude Code settings
// setup turned on are listed under Kept only when there are any.
test('the Never touched line holds only what no removal touches, and the settings from setup show only when set', t => {
  const h = fullHome(t);
  const text = removal.describePlan(h.make().plan()).join('\n');
  assert.ok(text.includes(`**Never touched**\n${removal.NEVER_TOUCHED}\n`));
  assert.match(text, /- \*\*No AI credit in commits:\*\* /);
  const bare = removal.describePlan(new removal.ToolkitRemoval({ home: s.tempHome(t), parts: [new parts.ClaudeUserSettingsPart({ environment: h.environment, home: s.tempHome(t), settings: { inspect: () => [] } })] }).plan()).join('\n');
  assert.doesNotMatch(bare, /Claude Code settings|AI credit/);
});

test('an update reports folder with no Toolkit report left is not listed again', t => {
  const h = recordsHome(t);
  fs.writeFileSync(path.join(h.reportDir, 'my-notes.md'), 'mine\n');
  const first = h.make().apply(h.make().plan().code);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(fs.readdirSync(h.reportDir), ['my-notes.md']);
  assert.deepEqual(itemsOf(h.make().plan(), 'update_reports'), [], 'only a folder holding a Toolkit report is listed');
});

test('an empty update reports folder is still listed and goes, with its parent', t => {
  const h = recordsHome(t);
  for (const name of fs.readdirSync(h.reportDir)) fs.rmSync(path.join(h.reportDir, name));
  const plan = h.make().plan();
  assert.deepEqual(itemsOf(plan, 'update_reports').map(item => item.action), ['remove']);
  assert.equal(h.make().apply(plan.code).ok, true);
  assert.equal(fs.existsSync(path.dirname(h.reportDir)), false);
});
