'use strict';

// toolkit permissions --apply: the owner's own one-command merge of the computer blocks. Agents
// cannot run it (host ask lines, agent markers, a real terminal and a typed word), it backs up
// before writing, keeps every other setting, and writes nothing on any stop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const permissions = require('../scripts/toolkit-permissions.cjs');
const apply = require('../scripts/toolkit-permissions-apply.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const TK = '/opt/toolkit';
const slashed = file => String(file).replace(/\\/g, '/');
const hostFs = { ...fs, existsSync: file => (slashed(file).startsWith(`${TK}/`) ? fs.existsSync(path.join(ROOT, slashed(file).slice(TK.length + 1))) : fs.existsSync(file)) };

// A fake computer with Toolkit at TK, the owner's terminal, and Codex set up unless told not to.
function computer(t, { codex = true, answer = 'apply' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-apply-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: TK }));
  if (codex) fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const out = [];
  const err = [];
  const asked = [];
  return {
    home, out, err, asked,
    settings: path.join(home, '.claude', 'settings.json'),
    rules: path.join(home, '.codex', 'rules', 'toolkit.rules'),
    deps: {
      home, platform: 'linux', environment: {}, cwd: '/work/repo', fs: hostFs, now: () => new Date('2026-11-12T11:00:00Z'),
      tty: () => ({ stdin: true, stdout: true }), ask: question => { asked.push(question); return answer; },
      stdout: text => out.push(text), stderr: text => err.push(text),
    },
  };
}
const blockFor = (deps, host) => new permissions.PermissionBlocks(deps).build({ host, scope: 'computer' }).blocks[0];
const files = home => {
  const list = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else list.push(path.relative(home, full).replace(/\\/g, '/')); } };
  walk(home);
  return list.sort();
};

test('merges the Claude block into the settings file, keeps every other setting, backs up first and reads back', async t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  const original = { model: 'x', env: { A: '1' }, permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm *)'], defaultMode: 'default' } };
  fs.writeFileSync(pc.settings, JSON.stringify(original, null, 4));
  const before = fs.readFileSync(pc.settings, 'utf8');
  assert.equal(await permissions.main(['--apply'], pc.deps), 0, pc.err.join(''));
  const block = blockFor(pc.deps, 'claude');
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)', ...block.allow]);
  assert.deepEqual(after.permissions.ask, block.ask);
  assert.deepEqual(after.permissions.deny, ['Bash(rm *)']);
  assert.equal(after.model, 'x');
  assert.deepEqual(after.env, { A: '1' });
  assert.equal(after.permissions.defaultMode, 'default');
  const backup = `${pc.settings}.toolkit-backup-20261112T110000000Z`;
  assert.equal(fs.readFileSync(backup, 'utf8'), before, 'the backup is the file as it was');
  assert.equal(fs.readFileSync(pc.rules, 'utf8'), blockFor(pc.deps, 'codex').text);
  assert.equal(pc.asked.length, 1);
  assert.match(pc.out.join(''), /\+ allow Bash\(node "\/opt\/toolkit\/repo\/scripts\/toolkit-store\.cjs" \*\)/);
  assert.equal(permissions.main(['--check', pc.settings, '--scope', 'computer'], { ...pc.deps, stdout: () => {} }), 0);
  assert.ok(files(pc.home).every(file => !/toolkit-tmp-/.test(file)), 'no temp file left');
});

test('a second run finds nothing to change, asks nothing and writes nothing', async t => {
  const pc = computer(t);
  assert.equal(await permissions.main(['--apply'], pc.deps), 0);
  const listed = files(pc.home);
  const text = fs.readFileSync(pc.settings, 'utf8');
  pc.asked.length = 0;
  pc.out.length = 0;
  assert.equal(await permissions.main(['--apply'], pc.deps), 0);
  assert.deepEqual(pc.asked, []);
  assert.match(pc.out.join(''), /Nothing to change\. Nothing was written\./);
  assert.deepEqual(files(pc.home), listed);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), text);
});

test('an agent shell, a missing terminal or any answer but apply writes nothing', async t => {
  for (const marker of apply.AGENT_MARKERS) {
    const pc = computer(t);
    const listed = files(pc.home);
    assert.equal(await permissions.main(['--apply'], { ...pc.deps, environment: { [marker]: '1' } }), 1, marker);
    assert.match(pc.err.join(''), new RegExp(`coding agent \\(${marker}\\)`));
    assert.deepEqual(pc.asked, [], 'the question is never asked in an agent shell');
    assert.deepEqual(files(pc.home), listed);
  }
  for (const tty of [{ stdin: false, stdout: true }, { stdin: true, stdout: false }]) {
    const pc = computer(t);
    const listed = files(pc.home);
    assert.equal(await permissions.main(['--apply'], { ...pc.deps, tty: () => tty }), 1);
    assert.match(pc.err.join(''), /needs a terminal you type into/);
    assert.deepEqual(files(pc.home), listed);
  }
  for (const answer of ['', 'y', 'yes', 'apply now', null]) {
    const pc = computer(t, { answer });
    const listed = files(pc.home);
    assert.equal(await permissions.main(['--apply'], pc.deps), 1, String(answer));
    assert.match(pc.out.join(''), /Stopped\. Nothing was written\./);
    assert.deepEqual(files(pc.home), listed);
  }
  // The real script, run the way an agent would (this test's own pipes, no terminal): refused.
  const pc = computer(t);
  const real = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'), '--apply'], { encoding: 'utf8', input: 'apply\n', env: { ...process.env, HOME: pc.home, USERPROFILE: pc.home, CLAUDECODE: '' }, cwd: os.tmpdir() });
  assert.equal(real.status, 1, real.stderr);
  assert.match(real.stderr, /coding agent|needs a terminal/);
  assert.equal(fs.existsSync(pc.settings), false);
});

test('a settings file Toolkit cannot merge safely is refused untouched', async t => {
  for (const text of ['{ not json', '[]', '"x"', JSON.stringify({ permissions: [] }), JSON.stringify({ permissions: { allow: 'Bash(x)' } }), JSON.stringify({ permissions: { ask: [1] } })]) {
    const pc = computer(t);
    fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
    fs.writeFileSync(pc.settings, text);
    const listed = files(pc.home);
    assert.equal(await permissions.main(['--apply', '--host', 'claude'], pc.deps), 1, text);
    assert.match(pc.err.join(''), /not a settings file Toolkit can merge into safely/);
    assert.equal(fs.readFileSync(pc.settings, 'utf8'), text);
    assert.deepEqual(files(pc.home), listed);
    assert.deepEqual(pc.asked, []);
  }
});

test('a file that changes after the preview stops before writing', async t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{}');
  const ask = () => { fs.writeFileSync(pc.settings, '{"model":"changed"}'); return 'apply'; };
  assert.equal(await permissions.main(['--apply', '--host', 'claude'], { ...pc.deps, ask }), 1);
  assert.match(pc.err.join(''), /changed after the preview/);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), '{"model":"changed"}');
  assert.ok(files(pc.home).every(file => !/toolkit-backup-|toolkit-tmp-/.test(file)));
});

test('stale Toolkit lines are reported and kept; a symlinked settings file is written through', async t => {
  const pc = computer(t, { codex: false });
  const realDir = path.join(pc.home, 'dotfiles');
  fs.mkdirSync(realDir, { recursive: true });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  const stale = 'Bash(node "/old/place/repo/scripts/toolkit-tasks.cjs" *)';
  fs.writeFileSync(path.join(realDir, 'settings.json'), JSON.stringify({ permissions: { allow: [stale] } }));
  try { fs.symlinkSync(path.join(realDir, 'settings.json'), pc.settings); } catch { t.skip('this computer cannot make a symlink'); return; }
  assert.equal(await permissions.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /! stale, kept: Bash\(node "\/old\/place/);
  assert.match(pc.out.join(''), /Codex: skipped\. Codex has no settings folder/);
  assert.ok(fs.lstatSync(pc.settings).isSymbolicLink(), 'the link stays a link');
  assert.ok(JSON.parse(fs.readFileSync(path.join(realDir, 'settings.json'), 'utf8')).permissions.allow.includes(stale));
  assert.equal(fs.existsSync(pc.rules), false, 'no Codex file without a Codex folder');
});

test('the Codex rules file is replaced whole and the change is listed rule by rule', async t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.rules), { recursive: true });
  fs.writeFileSync(pc.rules, 'prefix_rule(\n    pattern = ["old","thing"],\n    decision = "allow",\n)\n');
  assert.equal(await permissions.main(['--apply', '--host', 'codex'], pc.deps), 0, pc.err.join(''));
  assert.equal(fs.readFileSync(pc.rules, 'utf8'), blockFor(pc.deps, 'codex').text);
  assert.match(pc.out.join(''), /- allow old thing/);
  assert.match(pc.out.join(''), /\+ prompt node \/opt\/toolkit\/repo\/scripts\/toolkit-permissions\.cjs --apply/);
  assert.ok(fs.existsSync(`${pc.rules}.toolkit-backup-20261112T110000000Z`));
  assert.equal(fs.existsSync(pc.settings), false, '--host codex leaves Claude Code alone');
});

test('--apply goes first and takes only --host', async t => {
  const pc = computer(t);
  const quiet = { ...pc.deps, stdout: () => {}, stderr: () => {} };
  assert.equal(permissions.main(['--scope', 'computer', '--apply'], quiet), 2);
  assert.equal(permissions.main(['--json', '--apply'], quiet), 2);
  for (const args of [['--json'], ['--scope', 'repo'], ['--host', 'cursor'], ['--host'], ['--check', 'x']]) assert.equal(await permissions.main(['--apply', ...args], quiet), 2, args.join(' '));
  assert.deepEqual(pc.asked, []);
  assert.equal(fs.existsSync(pc.settings), false);
});

test('the blocks make --apply ask on Claude Code and prompt on Codex, anywhere on the line', t => {
  const pc = computer(t);
  const deps = { ...pc.deps, platform: 'win32', fs: { ...fs, existsSync: () => true } };
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: 'C:\\tk' }));
  const claude = new permissions.PermissionBlocks(deps).build({ scope: 'computer' }).blocks[0];
  for (const tool of ['Bash', 'PowerShell']) assert.ok(claude.ask.includes(`${tool}(node "C:/tk/repo/scripts/toolkit-permissions.cjs" *--apply*)`), tool);
  assert.ok(claude.allow.includes('Bash(node "C:/tk/repo/scripts/toolkit-permissions.cjs" *)'), 'printing stays allowed');
  const codex = new permissions.PermissionBlocks(deps).build({ host: 'codex', scope: 'computer' }).blocks[0];
  const rules = [...codex.text.matchAll(/pattern = (\[[^\n]+\]),\n {4}decision = "(\w+)"/g)].map(match => [JSON.parse(match[1]), match[2]]);
  const decide = tokens => { const hits = rules.filter(([pattern]) => pattern.every((token, index) => tokens[index] === token)).map(([, decision]) => decision); return hits.includes('prompt') ? 'prompt' : hits.includes('allow') ? 'allow' : 'none'; };
  assert.equal(decide(['node', 'C:/tk/repo/scripts/toolkit-permissions.cjs', '--apply']), 'prompt');
  assert.equal(decide(['node', 'C:/tk/repo/scripts/toolkit-permissions.cjs', '--apply', '--host', 'codex']), 'prompt');
  assert.equal(decide(['node', 'C:/tk/repo/scripts/toolkit-permissions.cjs', '--host', 'codex']), 'allow', 'printing stays allowed');
});

// ---- G2 round 1 findings: each test below reproduces one finding and holds the fix --------------

test('H1: run as a script, the --apply handoff gets the blocks class without requiring the loading script back', t => {
  const text = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'), 'utf8');
  assert.ok(text.indexOf('module.exports =') < text.indexOf('if (require.main === module)'), 'exports come before the entry point');
  // Node throws "not extensible" on a require of a still-loading module with frozen exports, so the
  // class travels in the deps. The terminal test below runs the real script end to end.
  assert.match(text, /toolkit-permissions-apply\.cjs'\)\.main\(argv\.slice\(1\), \{ \.\.\.deps, PermissionBlocks \}\)/);
  let seen = null;
  const pc = computer(t);
  return Promise.resolve(permissions.main(['--apply'], { ...pc.deps, ask: () => 'no', tty: () => { seen = 'reached'; return { stdin: true, stdout: true }; } })).then(code => {
    assert.equal(code, 1);
    assert.equal(seen, 'reached');
  });
});

test('M1 and L4: a rewrite keeps the file mode, indent, line endings and byte order mark', { skip: process.platform === 'win32' && 'file modes are POSIX only' }, async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, `﻿${JSON.stringify({ model: 'x', permissions: { allow: ['Bash(npm test)'] } }, null, '\t').replace(/\n/g, '\r\n')}\r\n`, { mode: 0o600 });
  fs.chmodSync(pc.settings, 0o600);
  assert.equal(await permissions.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.equal(fs.statSync(pc.settings).mode & 0o777, 0o600);
  const text = fs.readFileSync(pc.settings, 'utf8');
  assert.ok(text.startsWith('﻿{\r\n\t"model"'), 'BOM, CRLF and tab indent kept');
  assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
  assert.ok(JSON.parse(text.slice(1)).permissions.allow.includes('Bash(npm test)'));
});

test('L1: two runs in the same millisecond keep both backups and never crash', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{}');
  assert.equal(await permissions.main(['--apply'], pc.deps), 0);
  const settings = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  settings.permissions.allow.shift();
  fs.writeFileSync(pc.settings, JSON.stringify(settings));
  assert.equal(await permissions.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.deepEqual(files(pc.home).filter(file => /toolkit-backup-/.test(file)), ['.claude/settings.json.toolkit-backup-20261112T110000000Z', '.claude/settings.json.toolkit-backup-20261112T110000000Z-2']);
  assert.equal(fs.readFileSync(`${pc.settings}.toolkit-backup-20261112T110000000Z`, 'utf8'), '{}', 'the first backup is untouched');
});

test('L2: a settings link to a missing file stops and stays a link', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  try { fs.symlinkSync(path.join(pc.home, 'nowhere', 'settings.json'), pc.settings); } catch { t.skip('this computer cannot make a symlink'); return; }
  assert.equal(await permissions.main(['--apply'], pc.deps), 1);
  assert.match(pc.err.join(''), /link to a file that does not exist/);
  assert.ok(fs.lstatSync(pc.settings).isSymbolicLink());
  assert.deepEqual(pc.asked, []);
});

// H1 and H2 end to end: the real script in a real pseudo-terminal, with the typed word. The child
// gets a clean environment (no agent markers) and a temp home, so it touches nothing of anyone's.
test('H1 and H2: the real script in a terminal takes the typed apply and writes the block', { skip: (process.platform !== 'linux' || spawnSync('script', ['--version']).status !== 0) && 'needs util-linux script on Linux' }, async t => {
  const pc = computer(t, { codex: false });
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: ROOT }));
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{"model":"m"}');
  const env = { PATH: process.env.PATH, HOME: pc.home, TERM: 'dumb', LANG: 'C.UTF-8' };
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'))} --apply`;
  const child = require('node:child_process').spawn('script', ['-qec', command, '/dev/null'], { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let typed = false;
  const done = new Promise(resolve => child.on('close', code => resolve(code)));
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  child.stdout.on('data', chunk => {
    output += chunk;
    if (!typed && /Type apply/.test(output)) { typed = true; child.stdin.write('apply\r'); }
  });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await done;
  clearTimeout(timer);
  child.stdin.destroy();
  assert.equal(code, 0, output);
  assert.match(output, /Claude Code: added \d+ allow and \d+ ask lines/);
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  assert.equal(after.model, 'm');
  assert.ok(after.permissions.ask.some(line => /toolkit-permissions\.cjs" \*--apply\*/.test(line)));
});

// ---- the repo block: --apply also merges the Claude Code repo block of a governed repository ----

const ENABLED_BINDING = { schema: 'toolkit.programme-binding.v2', repository: 'Owner/Repo', governance: 'enabled', parents: [{ issue: 7, record_prefix: 'TEST-' }], store: { kind: 'github', repository: 'Owner/Store', branch: 'main', path: 'state/' }, required_checks: [] };
// A real folder for the repository, a fake Git that names it, and its programme file.
function governedRepo(t, pc, { binding = ENABLED_BINDING } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-repo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'toolkit-programme.json'), JSON.stringify(binding));
  const run = (cmd, args) => (args[1] === root && args.slice(2).join(' ') === 'rev-parse --path-format=absolute --git-common-dir' ? { status: 0, stdout: `${root}/.git\n` } : { status: 1, stdout: '' });
  return { root, local: path.join(root, '.claude', 'settings.local.json'), deps: { ...pc.deps, run } };
}

test('run from a governed repository, --apply also merges its Claude Code repo block and reads it back', async t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  fs.mkdirSync(path.dirname(repo.local), { recursive: true });
  fs.writeFileSync(repo.local, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2));
  const deps = { ...repo.deps, cwd: repo.root };
  assert.equal(await permissions.main(['--apply', '--host', 'claude'], deps), 0, pc.err.join(''));
  const built = new permissions.PermissionBlocks(deps).build({ host: 'claude', scope: 'repo' });
  const local = JSON.parse(fs.readFileSync(repo.local, 'utf8'));
  assert.deepEqual(local.permissions.allow, ['Bash(npm test)', ...built.blocks[0].allow]);
  assert.ok(local.permissions.allow.includes('Bash(gh pr comment *)'));
  assert.ok(fs.readdirSync(path.dirname(repo.local)).some(name => /^settings\.local\.json\.toolkit-backup-/.test(name)), 'backed up first');
  assert.ok(fs.existsSync(pc.settings), 'the computer block is merged too');
  const out = pc.out.join('');
  assert.match(out, /Claude Code repo block: .*settings\.local\.json/);
  assert.match(out, /Claude Code repo block: added \d+ allow and \d+ ask lines/);
  assert.equal(pc.asked.length, 1, 'one typed apply covers both files');
  assert.equal(permissions.main(['--check', repo.local, '--scope', 'repo'], { ...deps, stdout: () => {} }), 0);
});

test('--repo-root names the repository; one that is not governed stops with nothing written or asked', async t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  assert.equal(await permissions.main(['--apply', '--host', 'claude', '--repo-root', repo.root], repo.deps), 0, pc.err.join(''));
  assert.ok(fs.existsSync(repo.local), 'a new local settings file is made for the repo block');

  const other = computer(t, { codex: false });
  const off = governedRepo(t, other, { binding: { ...ENABLED_BINDING, governance: 'disabled' } });
  assert.equal(await permissions.main(['--apply', '--repo-root', off.root], off.deps), 1);
  assert.match(other.err.join(''), /Stopped: no repo block: .*Nothing was written\./);
  assert.deepEqual(other.asked, []);
  assert.equal(fs.existsSync(other.settings), false);
  assert.equal(fs.existsSync(off.local), false);
});

test('outside a governed repository --apply says so and merges the computer blocks only', async t => {
  const pc = computer(t, { codex: false });
  assert.equal(await permissions.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /Repo block: none here \(.*\)\. Run it from a governed repository, or add --repo-root <checkout>/);
  assert.ok(fs.existsSync(pc.settings));
});

test('--repo-root takes one folder once', async t => {
  const pc = computer(t);
  const quiet = { ...pc.deps, stdout: () => {}, stderr: () => {} };
  for (const args of [['--repo-root'], ['--repo-root', '--host'], ['--repo-root', 'a', '--repo-root', 'b']]) assert.equal(await permissions.main(['--apply', ...args], quiet), 2, args.join(' '));
  assert.deepEqual(pc.asked, []);
});

test('the printed shortcut is one pasteable command that carries --repo-root when a repo block was printed', t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  const out = [];
  assert.equal(permissions.main(['--scope', 'repo', '--repo-root', repo.root], { ...repo.deps, stdout: text => out.push(text) }), 0);
  const text = out.join('');
  assert.match(text, /Owner shortcut: paste this one command into your own PowerShell or terminal, then type apply\..*this repository's Claude Code block\. Agents never run it\./);
  assert.ok(text.includes(`\n    node "${TK}/repo/scripts/toolkit-permissions.cjs" --apply --repo-root "${repo.root}"\n`), text);
  assert.doesNotMatch(text, /no agent writes/);
});

test('the print opens with a plain table of every Toolkit command a block allows, and every allowed row has its explanation', t => {
  const grouped = permissions.TABLE_GROUPS.flatMap(group => group.ids);
  for (const row of permissions.ROWS) assert.ok(grouped.includes(row.id), `${row.id} has a table row`);
  assert.equal(new Set(grouped).size, grouped.length, 'each row is explained once');
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  const out = [];
  assert.equal(permissions.main(['--repo-root', repo.root], { ...repo.deps, stdout: text => out.push(text) }), 0);
  const text = out.join('');
  assert.ok(text.indexOf('| Command | Lets the agent | Still asks for | Still checked by |') < text.indexOf('== Computer block'), 'the table comes before the blocks');
  assert.match(text, /\| `gh pr comment` \(this repository\) \| Comment on this repository's pull requests\. \| `--delete-last` \|/);
  assert.match(text, /\| Evidence store \(`toolkit-store\.cjs`\) \|/);
  assert.doesNotMatch(text, /Windows tasks/, 'Windows-only rows are left out on Linux');
});
