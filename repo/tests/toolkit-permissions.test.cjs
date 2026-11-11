'use strict';

// toolkit permissions: the paste-once blocks. Every printed line comes from the table, every
// subcommand is classified, no line holds a never class, hostile paths are refused, and the
// command has no way to write a file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const permissions = require('../scripts/toolkit-permissions.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const source = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const listIn = (text, pattern) => JSON.parse(`[${pattern.exec(text)[1].replace(/'/g, '"').replace(/\s+/g, ' ')}]`);

// A fake computer: hub state naming a managed checkout, optionally with Claude Code running Toolkit
// from it. Reads go to the real files under a temp home; nothing here is the owner's.
function computer(t, { managed = ROOT, claude = true, platform = 'linux' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: managed }));
  if (claude) {
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'ai-agent-toolkit-local': { source: { source: 'directory', path: ROOT } } }));
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'ai-agent-toolkit@ai-agent-toolkit-local': [{ scope: 'user' }] } }));
  }
  return { home, platform, environment: {}, cwd: ROOT };
}
// A fake Git that answers for one governed repository and one store checkout.
function fakeGit({ root = '/work/repo', origin = 'https://github.com/owner/store.git' } = {}) {
  return (cmd, args) => {
    const rest = args.slice(2).join(' ');
    if (rest === 'rev-parse --path-format=absolute --git-common-dir') return { status: 0, stdout: `${root}/.git\n` };
    if (rest === 'remote get-url origin') return { status: 0, stdout: `${origin}\n` };
    return { status: 1, stdout: '' };
  };
}
const governedFs = (binding = { governance: 'enabled', store: { kind: 'github', repository: 'Owner/Store' } }) => ({
  ...fs,
  readFileSync: (file, ...rest) => (String(file).replace(/\\/g, '/').endsWith('/work/repo/.github/toolkit-programme.json') ? JSON.stringify(binding) : fs.readFileSync(file, ...rest)),
});

test('both blocks print from the table, parse as JSON and print the same bytes twice', t => {
  const deps = { ...computer(t), fs: governedFs(), run: fakeGit() };
  const print = () => { const out = []; const code = permissions.main(['--store', '/work/store'], { ...deps, stdout: text => out.push(text) }); return [code, out.join('')]; };
  const [code, text] = print();
  assert.equal(code, 0);
  assert.deepEqual(print(), [code, text]);
  const built = new permissions.PermissionBlocks(deps).build({ storePath: '/work/store' });
  assert.deepEqual(built.blocks.map(block => [block.host, block.scope]), [['claude', 'computer'], ['claude', 'repo']]);
  for (const block of built.blocks) assert.deepEqual(JSON.parse(block.text).permissions.allow, block.allow);
  const wanted = permissions.ROWS.filter(row => row.scope === 'computer' && !row.windowsOnly).map(row => `Bash(node "${ROOT.replace(/\\/g, '/')}/${row.script}"${row.sub ? ` ${row.sub}` : ''} *)`);
  assert.deepEqual(built.blocks[0].allow, wanted);
  assert.deepEqual(built.blocks[1].allow, ['Bash(gh pr comment *)', 'Bash(gh issue comment *)', 'Bash(gh pr merge *)', 'Bash(git -C "/work/store" push *)']);
  assert.ok(built.blocks[1].ask.includes('Bash(git -C "/work/store" push *--force*)') && built.blocks[1].ask.includes('Bash(gh pr merge *--admin*)'));
  assert.match(built.blocks[0].target.replace(/\\/g, '/'), /\/\.claude\/settings\.json$/);
  assert.match(built.blocks[1].target.replace(/\\/g, '/'), /\/work\/repo\/\.claude\/settings\.local\.json$/);
  assert.equal(built.coverage.length, built.blocks.reduce((sum, block) => sum + block.allow.length, 0));
  assert.ok(built.coverage.every(row => typeof row.guard === 'string' && row.guard.length > 20));
});

test('Windows prints Bash and PowerShell twins with the path in forward slashes inside double quotes', t => {
  const exists = { ...fs, existsSync: () => true };
  const plain = new permissions.PermissionBlocks({ ...computer(t, { managed: 'C:\\Users\\dev\\.ai-agent-toolkit\\checkout', claude: false, platform: 'win32' }), fs: exists }).build({ scope: 'computer' });
  assert.ok(plain.blocks[0].allow.includes('Bash(node "C:/Users/dev/.ai-agent-toolkit/checkout/skills/github-program-reconciler/scripts/programme.cjs" refresh *)'));
  assert.ok(plain.blocks[0].allow.includes('PowerShell(node "C:/Users/dev/.ai-agent-toolkit/checkout/repo/scripts/toolkit-windows-tasks.cjs" start *)'));
  assert.ok(plain.blocks[0].ask.includes('PowerShell(node "C:/Users/dev/.ai-agent-toolkit/checkout/repo/scripts/toolkit-windows-tasks.cjs" apply *--repair-owned*)'));
  const spaced = new permissions.PermissionBlocks({ ...computer(t, { managed: 'C:\\Users\\A Dev\\tk', claude: false, platform: 'win32' }), fs: exists }).build({ scope: 'computer' });
  assert.ok(spaced.blocks[0].allow.includes('Bash(node "C:/Users/A Dev/tk/skills/github-program-reconciler/scripts/programme.cjs" refresh *)'));
  const linux = new permissions.PermissionBlocks(computer(t)).build({ scope: 'computer' });
  assert.ok(linux.blocks[0].allow.every(line => line.startsWith('Bash(') && !/windows-tasks|update-scheduled-task/.test(line)));
});

test('every subcommand of the two multi-command scripts is classified as allow or ask', () => {
  const programme = listIn(source('skills/github-program-reconciler/scripts/programme.cjs'), /const COMMANDS = \[([^\]]+)\]/);
  const tasks = listIn(source('repo/scripts/toolkit-windows-tasks.cjs'), /const COMMANDS = Object\.freeze\(\[([^\]]+)\]\)/);
  assert.deepEqual([...permissions.PROGRAMME_ALLOW, ...Object.keys(permissions.PROGRAMME_ASK)].sort(), [...programme].sort());
  assert.deepEqual([...permissions.TASKS_ALLOW, ...Object.keys(permissions.TASKS_ASK)].sort(), [...tasks].sort());
  for (const row of permissions.ROWS.filter(item => item.kind === 'script')) assert.ok(fs.existsSync(path.join(ROOT, row.script)), row.script);
});

test('no printed line holds a never class, and the never list catches each class', t => {
  const deps = { ...computer(t, { platform: 'win32', managed: 'C:\\tk' }), fs: { ...governedFs(), existsSync: () => true }, run: fakeGit() };
  const built = new permissions.PermissionBlocks(deps).build({ storePath: 'C:\\store' });
  const lines = built.blocks.flatMap(block => block.allow);
  assert.ok(lines.length > 40);
  for (const line of lines) {
    assert.equal(permissions.NEVER.find(([, pattern]) => pattern.test(line)), undefined, line);
    assert.match(line, /^(?:Bash|PowerShell)\((?:node "C:\/tk\/(?:skills\/github-program-reconciler\/scripts|repo\/scripts)\/[a-z-]+\.cjs"(?: [a-z-]+)?|gh pr comment|gh issue comment|gh pr merge|git -C "C:\/store" push) \*\)$/);
  }
  assert.ok(built.blocks[0].allow.every(line => !/owner|store|work\/repo/i.test(line)), 'the computer block names no repository');
  const bad = ['Bash', 'Bash(*)', 'PowerShell(*)', 'Bash(node *)', 'Bash(python3 *)', 'Bash(* --version)', 'Bash(gh pr close *)', 'Bash(gh issue close *)', 'Bash(rm *)',
    'PowerShell(Remove-Item *)', 'Bash(git worktree remove *)', 'Bash(git branch -D *)', 'Bash(git reset *)', 'Bash(git rebase *)', 'Bash(cat ~/.claude/settings.json *)',
    'Bash(gh auth token *)', 'Bash(node C:/tk/repo/scripts/toolkit-env.cjs *)', 'mcp__github__merge_pull_request', 'PowerShell(Unregister-ScheduledTask *)'];
  for (const line of bad) assert.ok(permissions.NEVER.some(([, pattern]) => pattern.test(line)), line);
  assert.throws(() => new permissions.PermissionBlocks({ ...deps, home: computer(t, { platform: 'win32', managed: 'C:\\tk\\.codex\\rules' }).home }).build({ scope: 'computer' }), /a line would hold a settings or rules file/);
});

test('a path with a quote, wildcard, shell character, dot part or share is refused, never printed', t => {
  const refused = ['C:/a"b', "C:/a'b", 'C:/a*b', 'C:/a?b', 'C:/a$b', 'C:/a`b', 'C:/a;b', 'C:/a&b', 'C:/a|b', 'C:/a(b)', 'C:/a/../b', 'C:/a/./b', '//server/share/tk', 'C:/a\nb', 'C:/a\tb',
    'relative/path', 'C:', 'C:/a//b', 'C:/a/', 'C:/ a/b', 'C:/a /b', 'D:/a:b', '', 'C:/' + 'a'.repeat(400)];
  for (const input of refused) assert.equal(permissions.safePath(input, 'win32'), null, JSON.stringify(input));
  assert.equal(permissions.safePath('C:\\Users\\Dev One\\tk_1.2-x', 'win32'), 'C:/Users/Dev One/tk_1.2-x');
  assert.equal(permissions.safePath('/home/dev/tk', 'linux'), '/home/dev/tk');
  assert.equal(permissions.safePath('C:/Users/dev', 'linux'), null);
  hostile.expectDefaultDeny(assert, text => permissions.safePath(`/home/dev/${text}`, 'linux') !== null, hostile.cases(hostile.FAMILIES, ['shell']));
  const errors = [];
  const deps = { ...computer(t, { managed: '/home/dev/tk; rm -rf x' }), stderr: text => errors.push(text), stdout: () => assert.fail('nothing may be printed') };
  assert.equal(permissions.main([], deps), 1);
  assert.match(errors.join(''), /^Stopped: the Toolkit folder path holds a character a permission line cannot carry safely.* Next: /);
});

test('missing pieces stop with a plain line and leave only the safe part', t => {
  const errors = [];
  const none = computer(t); fs.rmSync(path.join(none.home, '.ai-agent-toolkit'), { recursive: true });
  assert.equal(permissions.main([], { ...none, stderr: text => errors.push(text) }), 1);
  assert.match(errors.pop(), /^Stopped: this computer has no recorded Toolkit folder.* Next: run setup toolkit/);
  assert.equal(permissions.main([], { ...computer(t, { managed: os.tmpdir() }), stderr: text => errors.push(text) }), 1);
  assert.match(errors.pop(), /^Stopped: the recorded Toolkit folder does not hold the Toolkit scripts/);

  const noHold = new permissions.PermissionBlocks({ ...computer(t, { claude: false }), fs: governedFs(), run: fakeGit() }).build({ storePath: '/work/store' });
  assert.deepEqual(noHold.blocks[1].allow, ['Bash(gh pr comment *)', 'Bash(gh issue comment *)', 'Bash(git -C "/work/store" push *)']);
  assert.match(noHold.stops[0].stopped, /^the merge line is left out: Claude Code does not run Toolkit from the Toolkit folder/);

  const wrongStore = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(), run: fakeGit({ origin: 'https://github.com/someone/else.git' }) }).build({ storePath: '/work/store' });
  assert.ok(wrongStore.blocks[1].allow.every(line => !line.includes('push')));
  assert.match(wrongStore.stops[0].stopped, /that folder is not a checkout of the evidence store the programme file names/);

  for (const binding of [{ governance: 'disabled' }, null]) {
    const off = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(binding), run: fakeGit() }).build({});
    assert.deepEqual(off.blocks.map(block => block.scope), ['computer']);
    assert.match(off.stops[0].stopped, /^no repo block: this repository has no Toolkit programme file with governance enabled/);
  }
  const codex = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(), run: fakeGit() }).build({ host: 'codex', storePath: '/work/store' });
  assert.ok(codex.blocks[1].allow.every(line => !line.includes('merge')), 'Codex never gets the merge line');
  assert.match(codex.blocks[0].text, /prefix_rule\(\n {4}pattern = \["node","[^"]+programme\.cjs","refresh"\],\n {4}decision = "allow"/);
  assert.match(codex.blocks[0].text, /pattern = \["node","[^"]+programme\.cjs","claim"\],\n {4}decision = "prompt"/);
});

test('the command cannot write: no write call in its source, and none attempted on a run', t => {
  const text = source('repo/scripts/toolkit-permissions.cjs');
  assert.doesNotMatch(text, /\b(?:writeFile|appendFile|mkdir|rmSync|rm\(|unlink|rename|copyFile|createWriteStream|truncate|chmod|symlink|open\()\w*/);
  const attempts = [];
  const guarded = new Proxy(governedFs(), { get: (target, key) => (/^(?:read|exists|lstat|stat|realpath)/.test(String(key)) || typeof target[key] !== 'function' ? target[key] : (...args) => { attempts.push(String(key)); throw new Error(`write attempted: ${String(key)}`); }) });
  const runs = [];
  const run = (cmd, args) => { runs.push(args.slice(2).join(' ')); return fakeGit()(cmd, args); };
  assert.equal(permissions.main(['--store', '/work/store', '--json'], { ...computer(t), fs: guarded, run, stdout: () => {} }), 0);
  assert.deepEqual(attempts, []);
  assert.deepEqual([...new Set(runs)].sort(), ['remote get-url origin', 'rev-parse --path-format=absolute --git-common-dir']);
});

test('--check reads a settings file and reports missing and stale lines without changing it', t => {
  const deps = { ...computer(t), fs: governedFs(), run: fakeGit() };
  const built = new permissions.PermissionBlocks(deps).build({ scope: 'computer' });
  const file = path.join(deps.home, 'settings.json');
  const stale = 'Bash(node "/old/place/repo/scripts/toolkit-tasks.cjs" *)';
  fs.writeFileSync(file, JSON.stringify({ model: 'x', permissions: { allow: [...built.blocks[0].allow.slice(1), stale, 'Bash(npm test)'] } }));
  const before = fs.readFileSync(file, 'utf8');
  const out = [];
  assert.equal(permissions.main(['--check', file, '--scope', 'computer', '--json'], { ...deps, stdout: text => out.push(text) }), 1);
  assert.deepEqual(JSON.parse(out.join('')).check, [{ scope: 'computer', missing: [built.blocks[0].allow[0]], stale: [stale] }]);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.writeFileSync(file, built.blocks[0].text);
  assert.equal(permissions.main(['--check', file, '--scope', 'computer'], { ...deps, stdout: () => {} }), 0);
});

test('the real script prints the allowed-tools form and refuses unknown arguments', t => {
  const deps = computer(t);
  const run = args => spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: deps.home, USERPROFILE: deps.home }, cwd: os.tmpdir() });
  const listed = run(['--scope', 'computer', '--format', 'allowed-tools']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(listed.stdout.trim().split('\n').every(line => /^(?:Bash|PowerShell)\(node ".+\.cjs"(?: [a-z-]+)? \*\)$/.test(line)));
  assert.equal(run(['--write']).status, 2);
  assert.equal(run(['--host', 'cursor']).status, 2);
});
