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

// The fake Linux computer keeps Toolkit here; reads under it are answered from this checkout, so the
// tests behave the same on a Windows runner.
const TK = '/opt/toolkit';
const slashed = file => String(file).replace(/\\/g, '/');
const hostFs = { ...fs, existsSync: file => (slashed(file).startsWith(`${TK}/`) ? fs.existsSync(path.join(ROOT, slashed(file).slice(TK.length + 1))) : fs.existsSync(file)) };

// A fake computer: hub state naming a managed checkout, optionally with Claude Code running Toolkit
// from it. Reads go to the real files under a temp home; nothing here is the owner's.
function computer(t, { managed = TK, claude = true, platform = 'linux' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: managed }));
  if (claude) {
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'ai-agent-toolkit-local': { source: { source: 'directory', path: ROOT } } }));
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'ai-agent-toolkit@ai-agent-toolkit-local': [{ scope: 'user' }] } }));
  }
  return { home, platform, environment: {}, cwd: '/work/repo', fs: hostFs };
}
// A fake Git that answers for one governed repository and one store checkout.
function fakeGit({ root = '/work/repo', origin = 'https://github.com/owner/store.git', pushUrl = null, config = {} } = {}) {
  return (cmd, args) => {
    const rest = args.slice(2).join(' ');
    if (rest === 'rev-parse --path-format=absolute --git-common-dir') return { status: 0, stdout: `${root}/.git\n` };
    if (rest === 'remote get-url origin') return { status: 0, stdout: `${origin}\n` };
    if (rest === 'remote get-url --push --all origin') return { status: 0, stdout: `${pushUrl || origin}\n` };
    if (rest.startsWith('config --get-all ')) return config[rest.slice(17)] ? { status: 0, stdout: `${config[rest.slice(17)]}\n` } : { status: 1, stdout: '' };
    return { status: 1, stdout: '' };
  };
}
const governedFs = (binding = { governance: 'enabled', store: { kind: 'github', repository: 'Owner/Store' } }) => ({
  ...hostFs,
  readFileSync: (file, ...rest) => (slashed(file).endsWith('/work/repo/.github/toolkit-programme.json') ? JSON.stringify(binding) : fs.readFileSync(file, ...rest)),
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
  const wanted = permissions.ROWS.filter(row => row.scope === 'computer' && !row.windowsOnly).flatMap(row => (row.forms || [' *']).map(form => `Bash(node "${TK}/${row.script}"${row.sub ? ` ${row.sub}` : ''}${form})`));
  assert.deepEqual(built.blocks[0].allow, wanted);
  assert.deepEqual(built.blocks[1].allow, ['Bash(gh pr comment *)', 'Bash(gh issue comment *)', 'Bash(git -C "/work/store" push origin main)']);
  assert.ok(built.blocks[1].ask.includes('Bash(git -C "/work/store" push *--force*)') && built.blocks.every(block => [...block.allow, ...block.ask].every(line => !/merge/.test(line))));
  assert.match(built.blocks[0].target.replace(/\\/g, '/'), /\/\.claude\/settings\.json$/);
  assert.match(built.blocks[1].target.replace(/\\/g, '/'), /\/work\/repo\/\.claude\/settings\.local\.json$/);
  assert.equal(built.coverage.length, built.blocks.reduce((sum, block) => sum + block.allow.length, 0), 'every allow line has its guard text');
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
  assert.ok(lines.includes('Bash(git -C "C:/store" push origin main)') && lines.includes('PowerShell(git -C "C:/store" push origin main)'), 'the store line is printed for a Windows path');
  for (const line of lines) {
    assert.equal(permissions.NEVER.find(([, pattern]) => pattern.test(line)), undefined, line);
    assert.match(line, /^(?:Bash|PowerShell)\((?:node "C:\/tk\/(?:skills\/github-program-reconciler\/scripts|repo\/scripts)\/[a-z-]+\.cjs"(?: [a-z-]+)? \*|node "C:\/tk\/repo\/scripts\/toolkit-(?:tasks|update-scheduled-task)\.cjs"(?: --apply)?(?: --json)?|gh pr comment \*|gh issue comment \*|git -C "C:\/store" push origin main)\)$/);
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
  assert.equal(permissions.main([], { ...computer(t, { managed: '/opt/empty' }), stderr: text => errors.push(text) }), 1);
  assert.match(errors.pop(), /^Stopped: the recorded Toolkit folder does not hold the Toolkit scripts/);

  const noHold = new permissions.PermissionBlocks({ ...computer(t, { claude: false }), fs: governedFs(), run: fakeGit() }).build({ storePath: '/work/store' });
  assert.deepEqual(noHold.blocks[1].allow, ['Bash(gh pr comment *)', 'Bash(gh issue comment *)', 'Bash(git -C "/work/store" push origin main)']);
  assert.ok(noHold.stops.every(stop => !/merge/.test(stop.stopped)));

  const wrongStore = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(), run: fakeGit({ origin: 'https://github.com/someone/else.git' }) }).build({ storePath: '/work/store' });
  assert.ok(wrongStore.blocks[1].allow.every(line => !line.includes('push')));
  assert.match(wrongStore.stops[0].stopped, /that folder is not a checkout of the evidence store the programme file names/);

  // A plain push follows the checkout's own push settings, so a checkout that would push elsewhere,
  // force or mirror gets no store line.
  for (const [label, world, said] of [
    ['a push address that is another repository', { pushUrl: 'https://github.com/someone/else.git' }, /pushes somewhere other than the evidence store/],
    ['a second push address', { pushUrl: 'https://github.com/owner/store.git\nhttps://github.com/someone/else.git' }, /pushes somewhere other than the evidence store/],
    ['a forcing push rule', { config: { 'remote.origin.push': '+refs/heads/main:refs/heads/main' } }, /has its own push rule \(remote\.origin\.push\)/],
    ['a mirror remote', { config: { 'remote.origin.mirror': 'true' } }, /has its own push rule \(remote\.origin\.mirror\)/],
  ]) {
    const odd = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(), run: fakeGit(world) }).build({ storePath: '/work/store' });
    assert.ok(odd.blocks[1].allow.every(line => !line.includes('push')), label);
    assert.match(odd.stops[0].stopped, said, label);
  }

  for (const binding of [{ governance: 'disabled' }, null]) {
    const off = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(binding), run: fakeGit() }).build({});
    assert.deepEqual(off.blocks.map(block => block.scope), ['computer']);
    assert.match(off.stops[0].stopped, /^no repo block: this repository has no Toolkit programme file with governance enabled/);
  }
  const codex = new permissions.PermissionBlocks({ ...computer(t), fs: governedFs(), run: fakeGit() }).build({ host: 'codex', storePath: '/work/store' });
  assert.ok(codex.blocks[1].allow.every(line => !line.includes('merge')), 'no block carries a merge line');
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
  assert.deepEqual([...new Set(runs)].sort(), ['config --get-all remote.origin.mirror', 'config --get-all remote.origin.push', 'remote get-url --push --all origin', 'remote get-url origin', 'rev-parse --path-format=absolute --git-common-dir']);
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
  const deps = computer(t, { managed: ROOT });
  const run = args => spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: deps.home, USERPROFILE: deps.home }, cwd: os.tmpdir() });
  const listed = run(['--scope', 'computer', '--format', 'allowed-tools']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(listed.stdout.trim().split('\n').every(line => /^(?:Bash|PowerShell)\(node ".+\.cjs"(?: [a-z-]+)?(?: \*| --apply| --json| --apply --json)?\)$/.test(line)));
  assert.equal(run(['--write']).status, 2);
  assert.equal(run(['--host', 'cursor']).status, 2);
});

// ---- review findings: each test below reproduces one finding and holds the fix ------------------

// How Claude Code reads a rule, as its permissions page states it: the whole command text is
// matched, * is any text, a trailing " *" also matches the bare command, and ask beats allow.
const ruleMatches = (rule, tool, command) => {
  const parsed = /^(Bash|PowerShell)\((.*)\)$/s.exec(rule);
  if (!parsed || parsed[1] !== tool) return false;
  const escape = text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const pattern = parsed[2].endsWith(' *') ? `${escape(parsed[2].slice(0, -2))}(?: .*)?` : escape(parsed[2]);
  return new RegExp(`^${pattern}$`, tool === 'PowerShell' ? 'is' : 's').test(command);
};
const verdict = (blocks, tool, command) => (blocks.some(block => block.ask.some(rule => ruleMatches(rule, tool, command))) ? 'ask'
  : blocks.some(block => block.allow.some(rule => ruleMatches(rule, tool, command))) ? 'allow' : 'prompt');

test('the store push line allows one exact push and nothing that rides on it', t => {
  const deps = { ...computer(t, { platform: 'win32', managed: 'C:\\tk' }), fs: { ...governedFs(), existsSync: () => true }, run: fakeGit() };
  const { blocks } = new permissions.PermissionBlocks(deps).build({ storePath: 'C:\\store' });
  const push = 'git -C "C:/store" push';
  for (const tool of ['Bash', 'PowerShell']) {
    assert.equal(verdict(blocks, tool, `${push} origin main`), 'allow', tool);
    const open = [
      `${push} --receive-pack="echo ran > MARKER; git-receive-pack" origin main`, `${push} --exec=evil origin main`,
      `${push} --mirr origin`, `${push} -d origin evidence-only`, `${push} --delet origin archive-2026-10`, `${push} --prun origin`,
      `${push} https://github.com/someone/else.git main`, `${push} other main`, `${push} -uf origin main`, `${push} origin '+main:main'`,
      `${push} origin main --force`, `${push} origin main:other`, `${push} origin main extra`, `${push} origin`, `${push}`, `${push} origin main && rm -rf x`,
      `${push} --force origin main`, `${push} -f origin main`, `${push} origin :main`, `${push} origin +main`,
      'git -C "C:/elsewhere" push origin main', 'git push origin main',
    ];
    for (const command of open) assert.notEqual(verdict(blocks, tool, command), 'allow', `${tool}: ${command}`);
  }
  assert.ok(blocks.flatMap(block => block.allow).filter(line => line.includes(' push')).every(line => !line.includes('*')), 'no push line carries a wildcard');
  const named = new permissions.PermissionBlocks({ ...deps, fs: { ...governedFs({ governance: 'enabled', store: { kind: 'github', repository: 'Owner/Store', branch: 'evidence' } }), existsSync: () => true } }).build({ storePath: 'C:\\store' });
  assert.ok(named.blocks[1].allow.includes('Bash(git -C "C:/store" push origin evidence)'));
  for (const branch of ['--mirror', 'a b', '+main', 'x..y', ':main', '*']) {
    const odd = new permissions.PermissionBlocks({ ...deps, fs: { ...governedFs({ governance: 'enabled', store: { kind: 'github', repository: 'Owner/Store', branch } }), existsSync: () => true } }).build({ storePath: 'C:\\store' });
    assert.ok(odd.blocks[1].allow.includes('Bash(git -C "C:/store" push origin main)'), `a strange branch name falls back to main: ${branch}`);
  }
});

test('script lines allow only what their guard text says; approval-bearing flags ask', t => {
  const deps = { ...computer(t, { platform: 'win32', managed: 'C:\\tk' }), fs: { ...governedFs(), existsSync: () => true }, run: fakeGit() };
  const { blocks } = new permissions.PermissionBlocks(deps).build({ storePath: 'C:\\store' });
  const node = script => `node "C:/tk/repo/scripts/${script}"`;
  const rows = [
    [`${node('toolkit-tasks.cjs')}`, 'allow'], [`${node('toolkit-tasks.cjs')} --json`, 'allow'],
    [`${node('toolkit-tasks.cjs')} --forget demo-footer-sweep`, 'prompt'], [`${node('toolkit-tasks.cjs')} --json --forget demo-footer-sweep`, 'prompt'],
    [`${node('toolkit-tasks.cjs')} --record --host codex --id x --name X --schedule daily --purpose p`, 'prompt'],
    [`${node('toolkit-update-scheduled-task.cjs')}`, 'allow'], [`${node('toolkit-update-scheduled-task.cjs')} --apply`, 'allow'], [`${node('toolkit-update-scheduled-task.cjs')} --apply --json`, 'allow'],
    [`${node('toolkit-update-scheduled-task.cjs')} --apply --answers C:/x/answers.json`, 'prompt'], [`${node('toolkit-update-scheduled-task.cjs')} --answers C:/x/answers.json --apply`, 'prompt'],
    [`${node('toolkit-windows-tasks.cjs')} apply --repo-root C:/repo`, 'allow'], [`${node('toolkit-windows-tasks.cjs')} apply`, 'allow'],
    [`${node('toolkit-windows-tasks.cjs')} apply --repo-root C:/repo --folder OTHER`, 'ask'], [`${node('toolkit-windows-tasks.cjs')} apply --no-first-run`, 'ask'],
    [`${node('toolkit-windows-tasks.cjs')} apply --repair-owned`, 'ask'],
    [`${node('toolkit-windows-tasks.cjs')} apply --task-choice replace --task demo --observed ${'a'.repeat(64)} --answer-ref chat-1`, 'ask'],
    [`${node('toolkit-windows-tasks.cjs')} remove --repo-root C:/repo`, 'prompt'], [`${node('toolkit-windows-tasks.cjs')} adopt --folder F --task T --id t --purpose p`, 'prompt'],
    [`${node('toolkit-windows-tasks.cjs')} start --task demo-footer-sweep`, 'allow'],
    ['gh pr comment 12 --body-file note.md', 'allow'], ['gh pr comment 12 --delete-last', 'ask'], ['gh issue comment 12 --delete-last --yes', 'ask'],
  ];
  for (const tool of ['Bash', 'PowerShell']) for (const [command, expected] of rows) assert.equal(verdict(blocks, tool, command), expected, `${tool}: ${command}`);
  // Every flag of a script printed with exact lines is known here, so a new flag fails until someone decides.
  const tasksFlags = [...source('repo/scripts/toolkit-tasks.cjs').matchAll(/'(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(tasksFlags)].sort(), ['--effort', '--forget', '--host', '--id', '--json', '--model', '--name', '--purpose', '--record', '--repository', '--schedule']);
  const updateFlags = [...source('repo/scripts/toolkit-update-scheduled-task.cjs').matchAll(/'(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(updateFlags)].sort(), ['--answers', '--apply', '--json']);
  const applyFlags = listIn(source('repo/scripts/toolkit-windows-tasks.cjs'), /apply: \[([^\]]+)\]/);
  assert.deepEqual(applyFlags, ['--repo-root', '--folder', '--task-choice', '--task', '--observed', '--answer-ref']);
  // Flags that take no value are pinned too: each is either harmless (--json) or has an ask line.
  const taskSwitches = [...source('repo/scripts/toolkit-windows-tasks.cjs').matchAll(/arg === '(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(taskSwitches)].sort(), ['--json', '--no-first-run', '--repair-owned', '--task-choice']);
  const programmeFlags = [...source('skills/github-program-reconciler/scripts/programme.cjs').matchAll(/'(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(programmeFlags)].sort(), ['--apply', '--assignment', '--at-head', '--body-file', '--catalogue', '--consume', '--controller', '--deadline-ms', '--dry-run', '--effort', '--finding', '--force-another', '--include-private', '--issue', '--json', '--lane', '--message-file', '--model', '--parent', '--parent-file', '--patch', '--plan-digest', '--pr', '--prefix', '--reason', '--record', '--refresh', '--repo-root', '--role', '--route-read-back', '--session', '--show-toplevel', '--supersede', '--takeover', '--takeover-record', '--verdict']);
  const wild = permissions.ROWS.filter(row => row.kind === 'script' && !row.sub && !row.forms).map(row => row.id);
  assert.deepEqual(wild, ['permissions-print'], 'only the print-only script keeps a bare wildcard');
  assert.deepEqual([...source('repo/scripts/toolkit-permissions.cjs').matchAll(/'(--[a-z-]+)': \[/g)].map(match => match[1]).sort(), ['--check', '--format', '--host', '--repo-root', '--scope', '--store']);
});

test('Codex gets no allow rule for a command that needs an exact form or an ask line', t => {
  const deps = { ...computer(t, { platform: 'win32', managed: 'C:\\tk' }), fs: { ...governedFs(), existsSync: () => true }, run: fakeGit() };
  const codex = new permissions.PermissionBlocks(deps).build({ host: 'codex', storePath: 'C:\\store' });
  const rules = codex.blocks.flatMap(block => [...block.text.matchAll(/pattern = (\[[^\n]+\]),\n {4}decision = "(\w+)"/g)].map(match => [JSON.parse(match[1]), match[2]]));
  // A Codex prefix rule matches when its tokens start the command; the strictest decision wins.
  const decide = tokens => { const hits = rules.filter(([pattern]) => pattern.every((token, index) => tokens[index] === token)).map(([, decision]) => decision); return hits.includes('prompt') ? 'prompt' : hits.includes('allow') ? 'allow' : 'none'; };
  const push = ['git', '-C', 'C:/store', 'push'];
  const tk = script => ['node', `C:/tk/repo/scripts/${script}`];
  const mustNotBeAllowed = [
    [...push, 'origin', 'main'], [...push, '--force'], [...push, '--mirror'], [...push, '--delete', 'origin', 'x'], [...push, 'origin', '+main'], [...push, '--receive-pack=evil', 'origin', 'main'],
    ['gh', 'pr', 'comment', '12', '--delete-last'], ['gh', 'pr', 'comment', '12', '--body', 'x'], ['gh', 'issue', 'comment', '12', '--delete-last'],
    [...tk('toolkit-windows-tasks.cjs'), 'apply', '--repair-owned'], [...tk('toolkit-windows-tasks.cjs'), 'apply', '--folder', 'X'], [...tk('toolkit-windows-tasks.cjs'), 'apply'],
    [...tk('toolkit-tasks.cjs'), '--forget', 'x'], [...tk('toolkit-tasks.cjs')], [...tk('toolkit-update-scheduled-task.cjs'), '--apply', '--answers', 'f'],
    [...tk('toolkit-windows-tasks.cjs'), 'remove'], [...tk('toolkit-windows-tasks.cjs'), 'adopt'],
  ];
  for (const tokens of mustNotBeAllowed) assert.notEqual(decide(tokens), 'allow', tokens.join(' '));
  for (const tokens of [[...push, '--force'], ['gh', 'pr', 'comment', '1'], [...tk('toolkit-windows-tasks.cjs'), 'apply', '--repair-owned']]) assert.equal(decide(tokens), 'prompt', tokens.join(' '));
  assert.equal(decide([...tk('toolkit-windows-tasks.cjs'), 'start', '--task', 'x']), 'allow');
  assert.equal(decide(['node', 'C:/tk/skills/github-program-reconciler/scripts/programme.cjs', 'refresh', '--apply']), 'allow');
  assert.ok(codex.blocks.every(block => block.excluded.length > 0));
  // Each example is the pattern's own token list, so a Toolkit folder with a space still matches itself.
  const spaced = new permissions.PermissionBlocks({ ...computer(t, { platform: 'win32', managed: 'C:\\Users\\A Dev\\tk' }), fs: { ...fs, existsSync: () => true } }).build({ host: 'codex', scope: 'computer' });
  for (const [, pattern, example] of spaced.blocks[0].text.matchAll(/pattern = (\[[^\n]+\]),\n[^\n]+\n[^\n]+\n {4}match = \[(\[[^\n]+\])\],/g)) assert.deepEqual(JSON.parse(example), JSON.parse(pattern));
  assert.match(spaced.blocks[0].text, /match = \[\["node","C:\/Users\/A Dev\/tk\//);
});
