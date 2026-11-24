'use strict';

// The hook scope check keeps Toolkit's hooks harness-specific (hook design playbook, "Harness-specific
// by default"). These tests run it on the real repository, on throwaway copies of the real hook files
// with one thing broken at a time, and on small fixtures for each rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SCOPE, check, inventory, readScope } = require('../scripts/check-hook-scope.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'check-hook-scope.cjs');
const CLAUDE_HOOKS = '.claude-plugin/hooks/hooks.json';
const CODEX_HOOKS = '.codex-plugin/hooks/hooks.json';
const realScope = () => JSON.parse(fs.readFileSync(path.join(ROOT, ...SCOPE.split('/')), 'utf8'));
const write = (root, rel, text) => {
  const target = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const tempRoot = (t, name) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hook-scope-${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

// A throwaway copy of the real hooks.json files, the scope file and every script the hooks load.
function realCopy(t) {
  const root = tempRoot(t, 'real');
  const scope = realScope();
  const files = new Set([SCOPE, ...Object.values(scope.hook_files).flat()]);
  for (const nodes of inventory(ROOT, scope).graphs.values()) for (const [rel, node] of nodes) for (const file of [rel, ...(node.data || [])]) files.add(file);
  for (const item of scope.dynamic_requires) for (const rel of item.loads) files.add(rel);
  for (const rel of files) write(root, rel, fs.readFileSync(path.join(ROOT, ...rel.split('/'))));
  return { root, scope, tracked: Object.values(scope.hook_files).flat() };
}
const runReal = (copy, scope = copy.scope, options = {}) => {
  write(copy.root, SCOPE, `${JSON.stringify(scope, null, 2)}\n`);
  return check(copy.root, { trackedFiles: copy.tracked, ...options });
};

// A small fixture: one hooks.json per harness, the scripts they run and a scope file.
const hookFile = commands => ({ hooks: Object.fromEntries(Object.entries(commands).map(([event, scripts]) => [event, [{ hooks: scripts.map(script => ({ type: 'command', command: `node "\${PLUGIN_ROOT}/${script}"` })) }]])) });
function fixture(t, { claude = {}, codex = {}, files = {}, scope = {} }) {
  const root = tempRoot(t, 'fixture');
  write(root, CLAUDE_HOOKS, JSON.stringify(hookFile(claude)));
  write(root, CODEX_HOOKS, JSON.stringify(hookFile(codex)));
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  const base = {
    schema: 'toolkit-hook-scope/v1',
    hook_files: { claude: [CLAUDE_HOOKS], codex: [CODEX_HOOKS] },
    vocabulary: realScope().vocabulary,
    hard_rules: [{ id: 'merge-hold', rule: 'No merge without the owner.' }],
    hooks: [], modules: [], boundaries: [], dynamic_requires: [], known_open: [],
  };
  write(root, SCOPE, JSON.stringify({ ...base, ...scope }));
  return (options = {}) => check(root, { trackedFiles: [CLAUDE_HOOKS, CODEX_HOOKS], ...options });
}
const row = (harness, script, events, rules = ['merge-hold']) => ({ harness, script, rules, events: Object.fromEntries(events.map(event => [event, 'Before the call runs, the moment that matters.'])) });
const ENTRY = (lib = './lib.cjs') => `'use strict';\nrequire(${JSON.stringify(lib)});\n`;
const has = (result, pattern) => assert.ok(result.errors.some(error => pattern.test(error)), `expected ${pattern}, got:\n${result.errors.join('\n')}`);

test('the repository passes with its known_open list, and the CLI says clear', () => {
  const result = check(ROOT, { baseScope: realScope() });
  assert.deepEqual(result.errors, []);
  assert.ok(realScope().known_open.length > 0, 'the list starts with the open items');
  const cli = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DIFF_BASE: 'HEAD' } });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^HOOK SCOPE: clear \(base [0-9a-f]{12}\)$/m);
});

test('a hooks.json command with no scope row fails, in the real hook files and in a fixture', t => {
  const copy = realCopy(t);
  const hooks = JSON.parse(fs.readFileSync(path.join(copy.root, CLAUDE_HOOKS), 'utf8'));
  hooks.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-new-check.cjs"' }] });
  write(copy.root, CLAUDE_HOOKS, JSON.stringify(hooks));
  write(copy.root, 'repo/scripts/toolkit-new-check.cjs', "'use strict';\n");
  has(runReal(copy), /runs repo\/scripts\/toolkit-new-check\.cjs on PreToolUse, but .* has no claude row for it/);

  const run = fixture(t, { claude: { PreToolUse: ['repo/scripts/a.cjs'] }, files: { 'repo/scripts/a.cjs': "'use strict';\n" } });
  has(run(), /has no claude row for it/);
});

test('a command that is not a node script in the repository fails', t => {
  const root = tempRoot(t, 'shell');
  write(root, CLAUDE_HOOKS, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash ~/stop.sh' }] }] } }));
  write(root, CODEX_HOOKS, JSON.stringify({ hooks: {} }));
  write(root, SCOPE, JSON.stringify({ schema: 'toolkit-hook-scope/v1', hook_files: { claude: [CLAUDE_HOOKS], codex: [CODEX_HOOKS] }, vocabulary: realScope().vocabulary, hard_rules: [], hooks: [], modules: [], known_open: [] }));
  has(check(root, { trackedFiles: [CLAUDE_HOOKS, CODEX_HOOKS] }), /"bash ~\/stop\.sh" is not a node script in the repository/);
});

test('a second command chained after the script, or a path that leaves its folder, is not a node script in the repository', t => {
  const copy = realCopy(t);
  const rel = copy.scope.hook_files.claude[0];
  const hooks = JSON.parse(fs.readFileSync(path.join(copy.root, ...rel.split('/')), 'utf8'));
  const stop = hooks.hooks.Stop[0].hooks.find(hook => hook.command.includes('toolkit-owed-check-hook.cjs'));
  stop.command += ' && node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-codex-helper-hook.cjs"';
  write(copy.root, rel, JSON.stringify(hooks));
  has(runReal(copy), /toolkit-owed-check-hook\.cjs" && node .* is not a node script in the repository/);

  const tails = [' && node x.cjs', '; node x.cjs', ' | node x.cjs', ' $(node x.cjs)', ' `node x.cjs`', ' --flag=$(id)', ' > out.txt'];
  for (const tail of tails) {
    const root = tempRoot(t, 'chain');
    write(root, CLAUDE_HOOKS, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "\${PLUGIN_ROOT}/repo/scripts/a.cjs"${tail}` }] }] } }));
    write(root, CODEX_HOOKS, JSON.stringify({ hooks: {} }));
    write(root, 'repo/scripts/a.cjs', "'use strict';\n");
    write(root, SCOPE, JSON.stringify({ schema: 'toolkit-hook-scope/v1', hook_files: { claude: [CLAUDE_HOOKS], codex: [CODEX_HOOKS] }, vocabulary: realScope().vocabulary, hard_rules: [{ id: 'merge-hold', rule: 'x' }], hooks: [row('claude', 'repo/scripts/a.cjs', ['Stop'])], modules: [], known_open: [] }));
    has(check(root, { trackedFiles: [CLAUDE_HOOKS, CODEX_HOOKS], baseScope: null }), /is not a node script in the repository/);
  }
  const files = { 'repo/scripts/a.cjs': "'use strict';\n" };
  const run = fixture(t, { claude: { Stop: ['repo/scripts/./a.cjs'] }, files, scope: { hooks: [row('claude', 'repo/scripts/a.cjs', ['Stop'])] } });
  assert.deepEqual(run({ baseScope: null }).errors, [], 'a ./ in the path names the same script');
  has(fixture(t, { claude: { Stop: ['repo/../../outside.cjs'] }, files })(), /is not a node script in the repository/);
});

test('a scope row for a hook no hooks.json runs any more fails until the row goes', t => {
  // The shape of removing a hook (the handoff snapshot hook): its hooks.json entries go, its row stays.
  const copy = realCopy(t);
  const script = 'repo/scripts/toolkit-handoff-hook.cjs';
  assert.ok(copy.scope.hooks.some(item => item.script === script), `${script} has a row`);
  for (const rel of copy.scope.hook_files.claude) {
    const hooks = JSON.parse(fs.readFileSync(path.join(copy.root, ...rel.split('/')), 'utf8'));
    for (const [event, groups] of Object.entries(hooks.hooks)) hooks.hooks[event] = groups.filter(group => !group.hooks.some(hook => hook.command.includes(script)));
    write(copy.root, rel, JSON.stringify(hooks));
  }
  const result = runReal(copy);
  assert.ok(result.errors.includes(`hook row claude ${script} names a script no claude hooks.json runs: remove the row`), result.errors.join('\n'));
  const scope = { ...copy.scope, hooks: copy.scope.hooks.filter(item => item.script !== script) };
  assert.deepEqual(runReal(copy, scope).errors, []);
});

test('an entry on an event its row does not list, or a listed event with no why_event line, fails', t => {
  const files = { 'repo/scripts/a.cjs': "'use strict';\n" };
  has(fixture(t, { claude: { PreToolUse: ['repo/scripts/a.cjs'], Stop: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [row('claude', 'repo/scripts/a.cjs', ['PreToolUse'])] } })(), /on Stop, an event its claude row does not list and justify/);
  const empty = row('claude', 'repo/scripts/a.cjs', ['PreToolUse']);
  empty.events.PreToolUse = ' ';
  has(fixture(t, { claude: { PreToolUse: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [empty] } })(), /lists PreToolUse with no why_event line/);
  has(fixture(t, { claude: { PreToolUse: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [row('claude', 'repo/scripts/a.cjs', ['PreToolUse', 'Stop'])] } })(), /lists Stop, but no claude hooks.json runs it there/);
});

test('a row naming a hard rule off the closed list, or harness-only with no reason, fails', t => {
  const files = { 'repo/scripts/a.cjs': "'use strict';\n" };
  has(fixture(t, { claude: { Stop: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [row('claude', 'repo/scripts/a.cjs', ['Stop'], ['made-up'])] } })(), /names hard rule made-up, which is not on the closed list/);
  has(fixture(t, { claude: { Stop: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [row('claude', 'repo/scripts/a.cjs', ['Stop'], 'harness-only')] } })(), /is harness-only, so it needs a reason/);
  const ok = fixture(t, { claude: { Stop: ['repo/scripts/a.cjs'] }, files, scope: { hooks: [{ ...row('claude', 'repo/scripts/a.cjs', ['Stop'], 'harness-only'), reason: 'A records job, not a hard rule.' }] } });
  assert.deepEqual(ok({ baseScope: null }).errors, []);
});

test('a script in two harnesses\' hooks.json files fails, in the real hook files and in a fixture', t => {
  const copy = realCopy(t);
  const scope = copy.scope;
  scope.known_open = scope.known_open.filter(item => item.id !== 'two-harnesses:repo/scripts/toolkit-programme-checkpoint-hook.cjs');
  has(runReal(copy, scope), /toolkit-programme-checkpoint-hook\.cjs runs from the claude and codex hooks\.json files/);

  const files = { 'repo/scripts/a.cjs': "'use strict';\n" };
  const rows = [row('claude', 'repo/scripts/a.cjs', ['Stop']), row('codex', 'repo/scripts/a.cjs', ['Stop'])];
  has(fixture(t, { claude: { Stop: ['repo/scripts/a.cjs'] }, codex: { Stop: ['repo/scripts/a.cjs'] }, files, scope: { hooks: rows } })(), /runs from the claude and codex hooks\.json files/);
});

test('one harness\'s hook script loaded by another harness\'s entry fails', t => {
  const files = { 'repo/scripts/claude-entry.cjs': "'use strict';\n", 'repo/scripts/codex-entry.cjs': ENTRY('./claude-entry.cjs') };
  const rows = [row('claude', 'repo/scripts/claude-entry.cjs', ['Stop']), row('codex', 'repo/scripts/codex-entry.cjs', ['Stop'])];
  has(fixture(t, { claude: { Stop: ['repo/scripts/claude-entry.cjs'] }, codex: { Stop: ['repo/scripts/codex-entry.cjs'] }, files, scope: { hooks: rows } })(), /claude-entry\.cjs is a claude hook entry that the codex entries also load/);
});

// Two entries, one per harness, sharing lib.cjs.
function sharedLib(t, lib, moduleRow = { path: 'repo/scripts/lib.cjs', kind: 'library', reason: 'A neutral reader.' }, extra = {}) {
  return fixture(t, {
    claude: { PreToolUse: ['repo/scripts/c.cjs'] }, codex: { PreToolUse: ['repo/scripts/x.cjs'] },
    files: { 'repo/scripts/c.cjs': ENTRY(), 'repo/scripts/x.cjs': "'use strict';\nconst path = require('node:path');\nrequire(path.join(__dirname, 'lib.cjs'));\n", 'repo/scripts/lib.cjs': lib },
    scope: { hooks: [row('claude', 'repo/scripts/c.cjs', ['PreToolUse']), row('codex', 'repo/scripts/x.cjs', ['PreToolUse'])], modules: moduleRow ? [moduleRow] : [], ...extra },
  });
}

test('a module both harnesses load needs a policy or library row', t => {
  has(sharedLib(t, "'use strict';\n", null)(), /repo\/scripts\/lib\.cjs is loaded by the claude and codex hooks but has no module row/);
  assert.deepEqual(sharedLib(t, "'use strict';\n")({ baseScope: null }).errors, []);
});

test('a shared module given another harness\'s tool name fails, in the real hook files and in a fixture', t => {
  const copy = realCopy(t);
  const rel = 'repo/scripts/toolkit-issue-closure.cjs';
  assert.ok(copy.scope.modules.some(m => m.path === rel || m.paths?.includes(rel)), `${rel} has a module row`);
  assert.deepEqual(runReal(copy).errors, [], 'the copy starts clean');
  fs.appendFileSync(path.join(copy.root, ...rel.split('/')), "\nconst PATCH_TOOLS = new Set(['apply_patch']);\n");
  has(runReal(copy), /toolkit-issue-closure\.cjs is a shared module holding harness vocabulary \(apply_patch at line \d+\)/);

  has(sharedLib(t, "'use strict';\nconst SHELLS = ['exec_command'];\n")(), /lib\.cjs is a shared module holding harness vocabulary \(exec_command at line 2\)/);
});

test('vocabulary counts tool names, environment names, output fields and harness comparisons, not comments or plain words', t => {
  const cases = [
    ["const matcher = /^(?:Bash|Monitor)$/;", /Bash at line 2, Monitor at line 2/],
    ['const remote = process.env.CLAUDE_CODE_REMOTE;', /CLAUDE_CODE_REMOTE/],
    ["const keys = ['CODEX_HOME'];", /CODEX_HOME/],
    ['const out = { hookSpecificOutput: {} };', /hookSpecificOutput/],
    ['const remote = process.env?.CLAUDE_CODE_REMOTE;', /CLAUDE_CODE_REMOTE/],
    ["if (host === 'codex') x();", /'codex'/],
    ["switch (host) { case 'claude': break; }", /'claude'/],
    ['const deadline = ({ claude: 7500, codex: 50000 })[host];', /'claude' at line 2, 'codex' at line 2/],
    ["const isClaude = ['claude'].includes(host);", /'claude'/],
    ["const CODEX = 'codex'; if (host === CODEX) x();", /'codex'/],
    ['const tools = { Bash: 1 };', /Bash/],
    ['const shell = /^Bash\\b/.test(name);', /Bash/],
    ['const reason = `${"Write"}`;', /Write/],
  ];
  for (const [line, pattern] of cases) has(sharedLib(t, `'use strict';\n${line}\n`)(), pattern);
  const clean = [
    '// The Bash tool and process.env.CLAUDE_CODE_REMOTE are named here only in a comment.',
    "/* hookSpecificOutput, 'exec_command' */",
    "const name = 'toolkit-shell-call';",
    "const task = /^(?:- Status: |<!-- Task status: )?DONE/;",
    'const CODEX_BLOCK_BEGIN = 1; module.exports = { CODEX_BLOCK_BEGIN };',
    "if (remote.host !== 'github.com') x();",
    "const ratio = a / b / c; const label = 'Bash tool';",
  ];
  for (const line of clean) assert.deepEqual(sharedLib(t, `'use strict';\n${line}\n`)({ baseScope: null }).errors, [], line);
});

test('not_vocabulary takes a plain word out with its reason, and fails once the word is gone', t => {
  const lib = "'use strict';\nconst line = 'Agent' + ' UAT owed';\n";
  const plain = { path: 'repo/scripts/lib.cjs', kind: 'library', reason: 'A neutral reader.', not_vocabulary: { Agent: "The word in 'Agent UAT owed', not a tool name." } };
  assert.deepEqual(sharedLib(t, lib, plain)({ baseScope: null }).errors, []);
  has(sharedLib(t, "'use strict';\n", plain)(), /not_vocabulary Agent is no longer found: remove it/);
  has(sharedLib(t, lib, { ...plain, not_vocabulary: { Agent: '' } })(), /not_vocabulary Agent needs a reason/);
});

test('a clean known_open item fails, in the real hook files and in a fixture', t => {
  const copy = realCopy(t);
  const scope = copy.scope;
  const id = 'two-harnesses:repo/scripts/toolkit-programme-checkpoint-hook.cjs';
  assert.ok(scope.known_open.some(item => item.id === id), `${id} is open`);
  // The shape S5 lands: Codex keeps the shared checkpoint file and Claude gets its own entry.
  for (const rel of scope.hook_files.claude) {
    const hooks = JSON.parse(fs.readFileSync(path.join(copy.root, ...rel.split('/')), 'utf8'));
    for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) hook.command = hook.command.replace('toolkit-programme-checkpoint-hook.cjs', 'toolkit-claude-checkpoint-hook.cjs');
    write(copy.root, rel, JSON.stringify(hooks));
  }
  write(copy.root, 'repo/scripts/toolkit-claude-checkpoint-hook.cjs', "'use strict';\n");
  for (const item of scope.hooks) if (item.harness === 'claude' && item.script.endsWith('toolkit-programme-checkpoint-hook.cjs')) item.script = 'repo/scripts/toolkit-claude-checkpoint-hook.cjs';
  const result = runReal(copy, scope);
  assert.ok(result.errors.includes(`known_open item ${id} is already clean: remove it from the list`), result.errors.join('\n'));

  const open = { id: 'vocabulary:repo/scripts/lib.cjs', terms: ['Bash'], owner: '#1474 S1' };
  has(sharedLib(t, "'use strict';\n", undefined, { known_open: [open] })(), /known_open item vocabulary:repo\/scripts\/lib\.cjs is already clean/);
});

test('a known_open item must list exactly the terms still found', t => {
  const open = terms => ({ known_open: [{ id: 'vocabulary:repo/scripts/lib.cjs', terms, owner: '#1474 S1' }] });
  const lib = "'use strict';\nconst SHELLS = ['Bash', 'PowerShell'];\n";
  assert.deepEqual(sharedLib(t, lib, undefined, open(['Bash', 'PowerShell']))({ baseScope: null }).errors, []);
  has(sharedLib(t, lib, undefined, open(['Bash', 'Monitor', 'PowerShell']))(), /lists Monitor, no longer found/);
  has(sharedLib(t, lib, undefined, open(['Bash']))(), /now holds PowerShell, which its known_open item does not list/);
  has(sharedLib(t, lib, undefined, { known_open: [{ id: 'vocabulary:repo/scripts/lib.cjs', terms: ['Bash', 'PowerShell'], owner: 'later' }] })(), /needs an id and an owner naming the issue/);
});

test('the known_open list only shrinks against the base', t => {
  const lib = "'use strict';\nconst SHELLS = ['Bash', 'PowerShell'];\n";
  const item = { id: 'vocabulary:repo/scripts/lib.cjs', terms: ['Bash', 'PowerShell'], owner: '#1474 S1' };
  const run = sharedLib(t, lib, undefined, { known_open: [item] });
  assert.deepEqual(run({ baseScope: { known_open: [item] } }).errors, []);
  has(run({ baseScope: { known_open: [] } }), /known_open item vocabulary:repo\/scripts\/lib\.cjs is new since the base/);
  has(run({ baseScope: { known_open: [{ ...item, terms: ['Bash'] }] } }), /gained PowerShell since the base/);
  assert.match(run({ baseScope: null }).notes.join('\n'), /no repo\/contracts\/hooks\/hook-scope\.json at the base/);
});

test('a require the check cannot follow fails closed unless declared with what it loads', t => {
  const lib = "'use strict';\nfunction load(file) { return require(file); }\nmodule.exports = load;\n";
  has(sharedLib(t, lib)(), /lib\.cjs: require\(file\).* cannot be followed, so the hook graph is unknown/);
  const declared = count => ({ dynamic_requires: [{ file: 'repo/scripts/lib.cjs', count, loads: ['repo/scripts/lib.cjs'], reason: 'Loads this same file from another checkout.' }] });
  assert.deepEqual(sharedLib(t, lib, undefined, declared(1))({ baseScope: null }).errors, []);
  has(sharedLib(t, lib, undefined, declared(2))(), /declares 2 require\(s\) the check cannot follow, but it has 1/);
});

test('a boundary is not walked, and a tracked hooks.json no harness lists fails', t => {
  const files = { 'repo/scripts/c.cjs': ENTRY('./updater.cjs'), 'repo/scripts/x.cjs': ENTRY('./updater.cjs'), 'repo/scripts/updater.cjs': ENTRY('./inner.cjs'), 'repo/scripts/inner.cjs': "'use strict';\nconst SHELLS = ['Bash'];\n" };
  const scope = { hooks: [row('claude', 'repo/scripts/c.cjs', ['Stop']), row('codex', 'repo/scripts/x.cjs', ['Stop'])], modules: [{ path: 'repo/scripts/updater.cjs', kind: 'library', reason: 'The updater.' }] };
  const run = fixture(t, { claude: { Stop: ['repo/scripts/c.cjs'] }, codex: { Stop: ['repo/scripts/x.cjs'] }, files, scope });
  has(run(), /inner\.cjs is loaded by the claude and codex hooks but has no module row/);
  const bounded = fixture(t, { claude: { Stop: ['repo/scripts/c.cjs'] }, codex: { Stop: ['repo/scripts/x.cjs'] }, files, scope: { ...scope, boundaries: [{ path: 'repo/scripts/updater.cjs', reason: 'The updater serves every harness.' }] } });
  assert.deepEqual(bounded({ baseScope: null }).errors, []);
  has(bounded({ trackedFiles: [CLAUDE_HOOKS, CODEX_HOOKS, '.gemini-plugin/hooks/hooks.json'] }), /\.gemini-plugin\/hooks\/hooks\.json is a hooks\.json no harness in .* lists/);
});

test('the scope file lists every hook entry with an event reason, and the playbook carries the rule', () => {
  const scope = realScope();
  assert.deepEqual(readScope(JSON.stringify(scope)).errors, []);
  for (const item of scope.hooks) for (const [event, why] of Object.entries(item.events)) assert.ok(why.length >= 30, `${item.harness} ${item.script} ${event} says why`);
  for (const item of scope.known_open) assert.match(item.owner, /#(1474|1254)\b/, item.id);
  const playbook = fs.readFileSync(path.join(ROOT, 'repo', 'docs', 'agent-playbooks', 'hook-design.md'), 'utf8');
  assert.match(playbook, /^## Harness-specific by default$/m);
  assert.match(playbook, /repo\/contracts\/hooks\/hook-scope\.json/);
});
