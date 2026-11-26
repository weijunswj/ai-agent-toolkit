'use strict';

// toolkit permissions --apply: the owner's own one-command merge of the computer blocks. Agents
// cannot run it (host ask lines, agent markers, a real terminal and a fresh Enter), it backs up
// before writing, keeps every other setting, and writes nothing on any stop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const permissions = require('../scripts/toolkit-permissions.cjs');
// --review, --apply and --remove run in toolkit-permissions-cli.cjs (its own process when typed); the
// tests call it in this process so they can hand it a temporary computer.
const cli = require('../scripts/toolkit-permissions-cli.cjs');
const apply = require('../scripts/toolkit-permissions-apply.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const TK = '/opt/toolkit';
const slashed = file => String(file).replace(/\\/g, '/');
const hostFs = { ...fs, existsSync: file => (slashed(file).startsWith(`${TK}/`) ? fs.existsSync(path.join(ROOT, slashed(file).slice(TK.length + 1))) : fs.existsSync(file)) };

// A fake computer with Toolkit at TK, the owner's terminal, and Codex set up unless told not to.
function computer(t, { codex = true, answer = true } = {}) {
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
      tty: () => ({ stdin: true, stdout: true }), confirm: effect => { asked.push(effect); return answer; },
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
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  const block = blockFor(pc.deps, 'claude');
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  assert.deepEqual(after.permissions.allow, ['Bash(npm test)', ...block.allow]);
  assert.deepEqual(after.permissions.ask, block.ask);
  assert.deepEqual(after.permissions.deny, ['Bash(rm *)']);
  assert.equal(after.model, 'x');
  assert.deepEqual(after.env, { A: '1' });
  assert.equal(after.permissions.defaultMode, 'default');
  // One backup folder per run, outside every checkout, with list.txt saying where each file goes back.
  const folder = path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', '20261112T110000Z');
  assert.equal(fs.readFileSync(path.join(folder, '1-settings.json'), 'utf8'), before, 'the backup is the file as it was');
  assert.match(fs.readFileSync(path.join(folder, 'list.txt'), 'utf8'), /^1-settings\.json {2}-> {2}.*settings\.json\n\(new file\) .*toolkit\.rules {2}<- delete it to undo\n$/);
  assert.ok(files(pc.home).every(file => !/toolkit-backup-/.test(file)), 'no backup beside the file');
  assert.equal(fs.readFileSync(pc.rules, 'utf8'), blockFor(pc.deps, 'codex').text);
  assert.equal(pc.asked.length, 1);
  assert.match(pc.out.join(''), /\n {2}add {5}toolkit-store\.cjs\n/);
  assert.match(pc.out.join(''), /Backup: ~\/\.ai-agent-toolkit\/backups\/permissions\/20261112T110000Z\n/);
  assert.equal(cli.main(['--check', pc.settings, '--scope', 'computer'], { ...pc.deps, stdout: () => {} }), 0);
  assert.ok(files(pc.home).every(file => !/toolkit-tmp-/.test(file)), 'no temp file left');
});

test('a second run finds nothing to change, asks nothing and writes nothing', async t => {
  const pc = computer(t);
  assert.equal(await cli.main(['--apply'], pc.deps), 0);
  const listed = files(pc.home);
  const text = fs.readFileSync(pc.settings, 'utf8');
  pc.asked.length = 0;
  pc.out.length = 0;
  assert.equal(await cli.main(['--apply'], pc.deps), 0);
  assert.deepEqual(pc.asked, []);
  assert.match(pc.out.join(''), /Nothing to change: Toolkit's lines are up to date\. No settings file was changed\./);
  assert.doesNotMatch(pc.out.join(''), /no Toolkit lines found/);
  assert.deepEqual(files(pc.home), listed);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), text);
});

test('an agent shell, a missing terminal or no Enter writes nothing', async t => {
  for (const marker of apply.AGENT_MARKERS) {
    const pc = computer(t);
    const listed = files(pc.home);
    assert.equal(await cli.main(['--apply'], { ...pc.deps, environment: { [marker]: '1' } }), 1, marker);
    assert.match(pc.err.join(''), new RegExp(`coding agent \\(${marker}\\)`));
    assert.deepEqual(pc.asked, [], 'the question is never asked in an agent shell');
    assert.deepEqual(files(pc.home), listed);
  }
  for (const tty of [{ stdin: false, stdout: true }, { stdin: true, stdout: false }]) {
    const pc = computer(t);
    const listed = files(pc.home);
    assert.equal(await cli.main(['--apply'], { ...pc.deps, tty: () => tty }), 1);
    assert.match(pc.err.join(''), /needs a terminal you type into/);
    assert.deepEqual(files(pc.home), listed);
  }
  for (const answer of [false, null, 'yes']) {
    const pc = computer(t, { answer });
    const listed = files(pc.home);
    assert.equal(await cli.main(['--apply'], pc.deps), 1, String(answer));
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
    assert.equal(await cli.main(['--apply', '--host', 'claude'], pc.deps), 1, text);
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
  const confirm = () => { fs.writeFileSync(pc.settings, '{"model":"changed"}'); return true; };
  assert.equal(await cli.main(['--apply', '--host', 'claude'], { ...pc.deps, confirm }), 1);
  assert.match(pc.err.join(''), /changed after the screen above/);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), '{"model":"changed"}');
  assert.ok(files(pc.home).every(file => !/toolkit-backup-|toolkit-tmp-|backups\//.test(file)), 'no temp file and no backup folder');
});

test('--apply takes out stale Toolkit lines and keeps the owner\'s own; a symlinked settings file is written through', async t => {
  const pc = computer(t, { codex: false });
  const realDir = path.join(pc.home, 'dotfiles');
  fs.mkdirSync(realDir, { recursive: true });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  const stale = 'Bash(node "/old/place/repo/scripts/toolkit-tasks.cjs" *)';
  const own = 'Bash(npm test)';
  fs.writeFileSync(path.join(realDir, 'settings.json'), JSON.stringify({ permissions: { allow: [own, stale] } }));
  try { fs.symlinkSync(path.join(realDir, 'settings.json'), pc.settings); } catch { t.skip('this computer cannot make a symlink'); return; }
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /remove {2}old Toolkit line toolkit-tasks\.cjs/);
  assert.match(pc.out.join(''), /Codex rules {2}skipped: Codex has no settings folder/);
  assert.ok(fs.lstatSync(pc.settings).isSymbolicLink(), 'the link stays a link');
  const allow = JSON.parse(fs.readFileSync(path.join(realDir, 'settings.json'), 'utf8')).permissions.allow;
  assert.ok(!allow.includes(stale), 'the stale Toolkit line is taken out');
  assert.equal(allow[0], own, 'the owner\'s own line stays first');
  assert.equal(fs.existsSync(pc.rules), false, 'no Codex file without a Codex folder');
});

test('the Codex rules file is replaced whole and the change is listed rule by rule', async t => {
  const pc = computer(t);
  fs.mkdirSync(path.dirname(pc.rules), { recursive: true });
  fs.writeFileSync(pc.rules, 'prefix_rule(\n    pattern = ["old","thing"],\n    decision = "allow",\n)\n');
  assert.equal(await cli.main(['--apply', '--host', 'codex'], pc.deps), 0, pc.err.join(''));
  assert.equal(fs.readFileSync(pc.rules, 'utf8'), blockFor(pc.deps, 'codex').text);
  assert.match(pc.out.join(''), /^Toolkit permissions: bring Toolkit's lines up to date\n/);
  assert.match(pc.out.join(''), /replace Toolkit's own rules file whole \(\d+ added, 1 removed\)/);
  assert.match(fs.readFileSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', '20261112T110000Z', '1-toolkit.rules'), 'utf8'), /"old","thing"/);
  assert.equal(fs.existsSync(pc.settings), false, '--host codex leaves Claude Code alone');
});

test('the restart line names only the apps whose files were written', async t => {
  const both = computer(t);
  assert.equal(await cli.main(['--apply'], both.deps), 0, both.err.join(''));
  assert.match(both.out.join(''), /\nRestart Claude Code and Codex so they read the new lines\.\n/);
  for (const [host, app, other] of [['claude', 'Claude Code', 'Codex'], ['codex', 'Codex', 'Claude Code']]) {
    const pc = computer(t);
    assert.equal(await cli.main(['--apply', '--host', host], pc.deps), 0, pc.err.join(''));
    const done = pc.out.join('').split('\n').find(line => line.startsWith('Restart '));
    assert.equal(done, `Restart ${app} so it reads the new lines.`);
    assert.ok(!done.includes(other), `--host ${host} never mentions ${other}`);
  }
  const current = computer(t);
  assert.equal(await cli.main(['--apply', '--host', 'codex'], current.deps), 0);
  current.out.length = 0;
  assert.equal(await cli.main(['--apply'], current.deps), 0, current.err.join(''));
  assert.match(current.out.join(''), /\nRestart Claude Code so it reads the new lines\.\n/, 'an app already current is not named');
});

test('--apply goes first and takes only --host', async t => {
  const pc = computer(t);
  const quiet = { ...pc.deps, stdout: () => {}, stderr: () => {} };
  assert.equal(cli.main(['--scope', 'computer', '--apply'], quiet), 2);
  assert.equal(cli.main(['--json', '--apply'], quiet), 2);
  for (const args of [['--json'], ['--scope', 'repo'], ['--host', 'cursor'], ['--host'], ['--check', 'x']]) assert.equal(await cli.main(['--apply', ...args], quiet), 2, args.join(' '));
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

test('H1: run as a script, --review, --apply and --remove run the CLI file as their own process; the file hooks load never loads it', t => {
  const text = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'), 'utf8');
  assert.ok(text.indexOf('module.exports =') < text.indexOf('if (require.main === module)'), 'exports come before the entry point');
  // Hooks load toolkit-permissions.cjs, so it must load none of the review, apply or CLI code (hook
  // scope: no harness vocabulary in hook code). The terminal tests below run the real script end to end.
  assert.doesNotMatch(text, /require\([^)]*toolkit-permissions-(?:cli|apply|review)\.cjs/);
  assert.match(text, /const CLI_FLAGS = Object\.freeze\(\['--review', \.\.\.OWNER_FLAGS\]\);/);
  assert.match(text, /spawnSync\(process\.execPath, \[path\.join\(__dirname, 'toolkit-permissions-cli\.cjs'\), \.\.\.argv\], \{ stdio: 'inherit'/);
  let seen = null;
  const pc = computer(t);
  return Promise.resolve(cli.main(['--apply'], { ...pc.deps, confirm: () => false, tty: () => { seen = 'reached'; return { stdin: true, stdout: true }; } })).then(code => {
    assert.equal(code, 1);
    assert.equal(seen, 'reached');
  });
});

test('M1 and L4: a rewrite keeps the file mode, indent, line endings and byte order mark', { skip: process.platform === 'win32' && 'file modes are POSIX only' }, async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, `﻿${JSON.stringify({ model: 'x', permissions: { allow: ['Bash(npm test)'] } }, null, '\t').replace(/\n/g, '\r\n')}\r\n`, { mode: 0o600 });
  fs.chmodSync(pc.settings, 0o600);
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.equal(fs.statSync(pc.settings).mode & 0o777, 0o600);
  // G2 round 1, L1: the backup of a 0600 file is 0600 too, in a folder only the owner reads.
  const folder = path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', '20261112T110000Z');
  assert.equal(fs.statSync(path.join(folder, '1-settings.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(folder).mode & 0o077, 0, 'no group or other access to the backup folder');
  const text = fs.readFileSync(pc.settings, 'utf8');
  assert.ok(text.startsWith('﻿{\r\n\t"model"'), 'BOM, CRLF and tab indent kept');
  assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
  assert.ok(JSON.parse(text.slice(1)).permissions.allow.includes('Bash(npm test)'));
});

test('L1: two runs in the same second keep both backup folders and never crash', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{}');
  assert.equal(await cli.main(['--apply'], pc.deps), 0);
  const settings = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  settings.permissions.allow.shift();
  fs.writeFileSync(pc.settings, JSON.stringify(settings));
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.deepEqual(files(pc.home).filter(file => /backups\//.test(file)), ['.ai-agent-toolkit/backups/permissions/20261112T110000Z-2/1-settings.json', '.ai-agent-toolkit/backups/permissions/20261112T110000Z-2/list.txt',
    '.ai-agent-toolkit/backups/permissions/20261112T110000Z/1-settings.json', '.ai-agent-toolkit/backups/permissions/20261112T110000Z/list.txt'].sort());
  assert.equal(fs.readFileSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', '20261112T110000Z', '1-settings.json'), 'utf8'), '{}', 'the first backup is untouched');
});

test('L2: a settings link to a missing file stops and stays a link', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  try { fs.symlinkSync(path.join(pc.home, 'nowhere', 'settings.json'), pc.settings); } catch { t.skip('this computer cannot make a symlink'); return; }
  assert.equal(await cli.main(['--apply'], pc.deps), 1);
  assert.match(pc.err.join(''), /link to a file that does not exist/);
  assert.ok(fs.lstatSync(pc.settings).isSymbolicLink());
  assert.deepEqual(pc.asked, []);
});

// H1 and H2 end to end: the real script in a real pseudo-terminal. A blank line typed ahead (the end of
// a pasted command block) never answers; Ctrl+C at the prompt writes nothing; a fresh Enter writes.
// The child gets a clean environment (no agent markers) and a temp home, so it touches nothing of anyone's.
test('H1 and H2: the real script in a terminal ignores a typed-ahead blank line, stops on Ctrl+C and writes on a fresh Enter', { skip: (process.platform !== 'linux' || spawnSync('script', ['--version']).status !== 0) && 'needs util-linux script on Linux' }, async t => {
  const pc = computer(t, { codex: false });
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: ROOT }));
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, '{"model":"m"}');
  const env = { PATH: process.env.PATH, HOME: pc.home, TERM: 'dumb', LANG: 'C.UTF-8' };
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'))} --apply`;
  const run = key => new Promise(resolve => {
    const child = require('node:child_process').spawn('script', ['-qec', command, '/dev/null'], { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let typed = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', code => { clearTimeout(timer); child.stdin.destroy(); resolve({ code, output }); });
    child.stdin.write('\r');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!typed && /Press Enter to back up and write/.test(output)) { typed = true; setTimeout(() => child.stdin.write(key), 1500); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
  });
  const stopped = await run('\x03');
  assert.equal(stopped.code, 1, stopped.output);
  assert.match(stopped.output, /Stopped\. Nothing was written\./);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), '{"model":"m"}');
  const { code, output } = await run('\r');
  assert.equal(code, 0, output);
  assert.match(output, /Done: 1 file written, \d+ lines added, 0 removed\./);
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  assert.equal(after.model, 'm');
  assert.ok(after.permissions.ask.some(line => /toolkit-permissions\.cjs" \*--apply\*/.test(line)));
});

// ---- the repo block: --apply also merges the Claude Code repo block of a governed repository ----

const ENABLED_BINDING = { schema: 'toolkit.programme-binding.v2', repository: 'Owner/Repo', governance: 'enabled', parents: [{ issue: 7, record_prefix: 'TEST-' }], store: { kind: 'github', repository: 'Owner/Store', branch: 'main', path: 'state/' }, required_checks: [] };
// The repository lives at the POSIX path /work/repo, as the Linux computer() sees it; every file call
// under that path goes to a real temporary folder, so the test runs the same on Windows.
const VROOT = '/work/repo';
function governedRepo(t, pc, { binding = ENABLED_BINDING } = {}) {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-repo-'));
  t.after(() => fs.rmSync(real, { recursive: true, force: true }));
  fs.mkdirSync(path.join(real, '.github'), { recursive: true });
  fs.writeFileSync(path.join(real, '.github', 'toolkit-programme.json'), JSON.stringify(binding));
  const map = arg => {
    if (typeof arg !== 'string') return arg;
    // On Windows, path.resolve gives the POSIX path a drive letter; it is still the same folder.
    const text = slashed(arg).replace(/^[A-Za-z]:(?=\/)/, '');
    return text === VROOT || text.startsWith(`${VROOT}/`) ? path.join(real, text.slice(VROOT.length)) : arg;
  };
  const repoFs = new Proxy(hostFs, { get: (target, name) => (typeof target[name] === 'function' ? (...args) => target[name](...args.map(map)) : target[name]) });
  const run = (cmd, args) => (slashed(args[1]) === VROOT && args.slice(2).join(' ') === 'rev-parse --path-format=absolute --git-common-dir' ? { status: 0, stdout: `${VROOT}/.git\n` } : { status: 1, stdout: '' });
  return { root: VROOT, local: path.join(real, '.claude', 'settings.local.json'), realRoot: real, deps: { ...pc.deps, fs: repoFs, run } };
}

test('run from a governed repository, --apply also merges its Claude Code repo block and reads it back', async t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  fs.mkdirSync(path.dirname(repo.local), { recursive: true });
  fs.writeFileSync(repo.local, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2));
  const deps = { ...repo.deps, cwd: repo.root };
  assert.equal(await cli.main(['--apply', '--host', 'claude'], deps), 0, pc.err.join(''));
  const built = new permissions.PermissionBlocks(deps).build({ host: 'claude', scope: 'repo' });
  const local = JSON.parse(fs.readFileSync(repo.local, 'utf8'));
  assert.deepEqual(local.permissions.allow, ['Bash(npm test)', ...built.blocks[0].allow]);
  assert.ok(local.permissions.allow.includes('Bash(gh pr comment *)'));
  assert.equal(fs.readFileSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', '20261112T110000Z', '2-settings.local.json'), 'utf8'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2), 'backed up first');
  assert.deepEqual(fs.readdirSync(path.dirname(repo.local)), ['settings.local.json'], 'nothing is left in the repository');
  assert.ok(fs.existsSync(pc.settings), 'the computer block is merged too');
  const out = pc.out.join('');
  assert.match(out, /\nrepo settings {2}\.claude\/settings\.local\.json\n {2}add {5}gh pr comment\n {2}add {5}gh issue comment\n/);
  assert.match(out, /Done: 2 files written, \d+ lines added, 0 removed\./);
  assert.equal(pc.asked.length, 1, 'one Enter covers both files');
  assert.equal(cli.main(['--check', repo.local, '--scope', 'repo'], { ...deps, stdout: () => {} }), 0);
});

test('--repo-root names the repository; one Toolkit does not govern gets no line, and a folder outside Git stops', async t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  assert.equal(await cli.main(['--apply', '--host', 'claude', '--repo-root', repo.root], repo.deps), 0, pc.err.join(''));
  assert.ok(fs.existsSync(repo.local), 'a new local settings file is made for the repo block');

  const other = computer(t, { codex: false });
  const off = governedRepo(t, other, { binding: { ...ENABLED_BINDING, governance: 'disabled' } });
  // A repository Toolkit does not govern gets no Toolkit line; the computer's lines still come up to date.
  assert.equal(await cli.main(['--apply', '--repo-root', off.root], off.deps), 0, other.err.join(''));
  assert.match(other.out.join(''), /\nrepo is not governed by Toolkit, so Toolkit adds no lines there\.\n/);
  assert.ok(fs.existsSync(other.settings));
  assert.equal(fs.existsSync(off.local), false, 'no settings file is made in it');
  const nowhere = computer(t, { codex: false });
  assert.equal(await cli.main(['--apply', '--repo-root', '/not/a/repo'], { ...nowhere.deps, run: () => ({ status: 1, stdout: '' }) }), 1);
  assert.match(nowhere.err.join(''), /that folder is not inside a Git repository/);
  assert.equal(fs.existsSync(nowhere.settings), false);
});

test('outside a governed repository --apply says so and merges the computer blocks only', async t => {
  const pc = computer(t, { codex: false });
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /Repo block: none here \(.*\)\. Run it from a governed repository, or add --repo-root <checkout>/);
  assert.ok(fs.existsSync(pc.settings));
});

test('--repo-root takes one folder once', async t => {
  const pc = computer(t);
  const quiet = { ...pc.deps, stdout: () => {}, stderr: () => {} };
  for (const args of [['--repo-root'], ['--repo-root', '--host'], ['--repo-root', 'a', '--repo-root', 'b']]) assert.equal(await cli.main(['--apply', ...args], quiet), 2, args.join(' '));
  assert.deepEqual(pc.asked, []);
});

test('the printed shortcut is one pasteable command that carries --repo-root when a repo block was printed', t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  const out = [];
  assert.equal(cli.main(['--scope', 'repo', '--repo-root', repo.root], { ...repo.deps, stdout: text => out.push(text) }), 0);
  const text = out.join('');
  assert.match(text, /Owner shortcut: paste this one command into your own PowerShell or terminal, then press Enter\..*this repository's Claude Code block\. Agents never run it\./);
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
  assert.equal(cli.main(['--repo-root', repo.root], { ...repo.deps, stdout: text => out.push(text) }), 0);
  const text = out.join('');
  assert.ok(text.indexOf('| Command | Lets the agent | Still asks for | Still checked by |') < text.indexOf('== Computer block'), 'the table comes before the blocks');
  assert.match(text, /\| `gh pr comment` \(this repository\) \| Comment on this repository's pull requests\. \| `--delete-last` \|/);
  assert.match(text, /\| Evidence store \(`toolkit-store\.cjs`\) \|/);
  assert.doesNotMatch(text, /Windows tasks/, 'Windows-only rows are left out on Linux');
});

test('--remove takes every Toolkit line out, keeps the owner\'s own, and deletes Toolkit\'s Codex rules file with a backup', async t => {
  const pc = computer(t);
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  const own = 'Bash(npm test)';
  const settings = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  settings.permissions.allow.unshift(own);
  settings.permissions.allow.push('Bash(node "/old/place/repo/scripts/toolkit-tasks.cjs" *)');
  settings.permissions.ask.push('Bash(node "/old/place/repo/scripts/toolkit-windows-tasks.cjs" apply *)', 'Bash(rm *)');
  fs.writeFileSync(pc.settings, JSON.stringify(settings, null, 2));
  pc.out.length = 0;
  assert.equal(await cli.main(['--remove'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /^Toolkit permissions: take Toolkit's lines out\n/);
  assert.match(pc.out.join(''), /\n {2}remove {2}programme\.cjs \(18 commands\)\n/, 'a script\'s many lines show as one row');
  assert.match(pc.out.join(''), /Codex rules {2}.*toolkit\.rules\n {2}delete {2}Toolkit's own rules file/);
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8')).permissions;
  assert.deepEqual(after.allow, [own], 'only the owner\'s own line is left, the stale Toolkit line went too');
  assert.deepEqual(after.ask, ['Bash(rm *)'], 'an old Toolkit ask line goes too; the owner\'s own ask stays');
  assert.equal(fs.existsSync(pc.rules), false);
  assert.ok(fs.readdirSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions')).some(folder => fs.readdirSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions', folder)).includes('2-toolkit.rules')), 'the deleted rules file keeps a backup');
  pc.out.length = 0;
  assert.equal(await cli.main(['--remove'], pc.deps), 0);
  assert.match(pc.out.join(''), /Nothing to change: no Toolkit lines found\. No settings file was changed\./, 'a second run finds nothing to take out');
  const quiet = { ...pc.deps, environment: { CLAUDECODE: '1' }, stdout: () => {}, stderr: text => pc.err.push(text) };
  assert.equal(await cli.main(['--remove'], quiet), 1);
  assert.match(pc.err.join(''), /Agents never run --remove/);
  assert.equal(cli.main(['--json', '--remove'], { ...pc.deps, stdout: () => {}, stderr: () => {} }), 2, '--remove goes first');
});

test('--apply keeps an owner\'s node line for another repository\'s script', async t => {
  const pc = computer(t, { codex: false });
  const own = 'Bash(node "/work/other/repo/scripts/build.cjs" *)';
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: [own] } }));
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.ok(JSON.parse(fs.readFileSync(pc.settings, 'utf8')).permissions.allow.includes(own));
  assert.doesNotMatch(pc.out.join(''), /build\.cjs/, 'it is not shown as a change');
});

// ---- the record of added lines: --remove takes out only what Toolkit added --------------------------

const recordOf = pc => JSON.parse(fs.readFileSync(path.join(pc.home, '.ai-agent-toolkit', 'user-state', 'permission-lines.json'), 'utf8'));

test('apply records the lines it added; remove keeps a line the owner had that the record does not hold', async t => {
  const pc = computer(t, { codex: false });
  const block = blockFor(pc.deps, 'claude');
  const typed = block.allow.find(line => / gate-session /.test(line));
  // The owner typed one of Toolkit's lines themselves, and Toolkit's record (from an earlier apply)
  // holds every other line of the block but not that one.
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: block.allow.filter(line => line !== typed) } }));
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  const key = path.resolve(pc.settings);
  assert.deepEqual(recordOf(pc).files[key].allow, block.allow.filter(line => line !== typed).concat(typed), 'lines there before any record count as Toolkit\'s, plus the line it added');
  assert.deepEqual(recordOf(pc).files[key].ask, block.ask);
  const record = recordOf(pc);
  record.files[key].allow = record.files[key].allow.filter(line => line !== typed);
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'user-state', 'permission-lines.json'), JSON.stringify(record));
  const settings = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  settings.permissions.allow.push('Bash(node "/old/place/repo/scripts/toolkit-windows-tasks.cjs" plan *)', 'Bash(npm test)');
  fs.writeFileSync(pc.settings, JSON.stringify(settings));
  pc.out.length = 0;
  assert.equal(await cli.main(['--remove', '--host', 'claude'], pc.deps), 0, pc.err.join(''));
  assert.deepEqual(JSON.parse(fs.readFileSync(pc.settings, 'utf8')).permissions, { allow: [typed, 'Bash(npm test)'], ask: [] }, 'the owner\'s identical line stays, a retired Toolkit line goes');
  assert.equal(recordOf(pc).files[key], undefined, 'the file leaves the record');
});

test('remove works from the record when the Toolkit folder is gone, in every recorded file', async t => {
  const pc = computer(t, { codex: false });
  const repo = governedRepo(t, pc);
  assert.equal(await cli.main(['--apply', '--host', 'claude', '--repo-root', repo.root], repo.deps), 0, pc.err.join(''));
  for (const file of [pc.settings, repo.local]) {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.permissions.allow.push('Bash(npm test)');
    fs.writeFileSync(file, JSON.stringify(settings));
  }
  // The managed checkout is gone: state.json still names it.
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: '/gone/toolkit' }));
  const lines = file => JSON.parse(fs.readFileSync(file, 'utf8')).permissions.allow.filter(line => line !== 'Bash(npm test)');
  assert.ok(lines(pc.settings).length > 0);
  pc.out.length = 0;
  pc.asked.length = 0;
  const elsewhere = { ...repo.deps, cwd: '/somewhere/else' };
  assert.equal(await cli.main(['--remove', '--host', 'claude'], elsewhere), 0, pc.err.join(''));
  assert.deepEqual(lines(pc.settings), [], 'the computer file loses the recorded lines');
  assert.deepEqual(lines(repo.local), [], 'the recorded repository file too, from any folder');
  assert.deepEqual(JSON.parse(fs.readFileSync(repo.local, 'utf8')).permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(pc.asked, ['back up and write 2 files']);
});

// ---- the auto mode rule: Claude Code reads autoMode from user settings only, and a list without
// "$defaults" replaces its built-in rules (https://code.claude.com/docs/en/auto-mode-config) -----------

test('apply adds the auto mode rule after "$defaults" in a list it creates, and remove takes both out again', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ model: 'x' }));
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /\n {2}add {5}auto mode rule for merges Toolkit's merge hold lets through\n/);
  assert.deepEqual(JSON.parse(fs.readFileSync(pc.settings, 'utf8')).autoMode, { allow: ['$defaults', ...permissions.AUTO_MODE_ALLOW] });
  assert.equal(recordOf(pc).files[path.resolve(pc.settings)].defaults_added, true);
  pc.out.length = 0;
  assert.equal(await cli.main(['--remove'], pc.deps), 0, pc.err.join(''));
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8'));
  assert.equal(after.autoMode, undefined, 'the list Toolkit made goes with its rule');
  assert.equal(after.model, 'x');
});

test('an owner\'s auto mode list keeps its own rules and its own choice about "$defaults"; an old Toolkit rule is replaced', async t => {
  const pc = computer(t, { codex: false });
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  const old = `${permissions.AUTO_MODE_MARK}an older wording of the merge rule.`;
  fs.writeFileSync(pc.settings, JSON.stringify({ autoMode: { allow: ['Deploying to staging is allowed', old], soft_deny: ['Never run terraform apply'] } }));
  assert.equal(await cli.main(['--apply'], pc.deps), 0, pc.err.join(''));
  assert.match(pc.out.join(''), /remove {2}old Toolkit auto mode rule/);
  assert.deepEqual(JSON.parse(fs.readFileSync(pc.settings, 'utf8')).autoMode, { allow: ['Deploying to staging is allowed', ...permissions.AUTO_MODE_ALLOW], soft_deny: ['Never run terraform apply'] });
  assert.equal(await cli.main(['--remove'], pc.deps), 0, pc.err.join(''));
  assert.deepEqual(JSON.parse(fs.readFileSync(pc.settings, 'utf8')).autoMode, { allow: ['Deploying to staging is allowed'], soft_deny: ['Never run terraform apply'] });
  for (const broken of [{ autoMode: 'x' }, { autoMode: { allow: 'x' } }, { autoMode: { allow: [1] } }]) {
    const other = computer(t, { codex: false });
    fs.mkdirSync(path.dirname(other.settings), { recursive: true });
    fs.writeFileSync(other.settings, JSON.stringify(broken));
    assert.equal(await cli.main(['--apply'], other.deps), 1, JSON.stringify(broken));
    assert.match(other.err.join(''), /autoMode setting Toolkit cannot merge into safely|not a settings file Toolkit can merge into safely/);
    assert.equal(fs.readFileSync(other.settings, 'utf8'), JSON.stringify(broken));
  }
});

// The owner's --drop run in a real pseudo-terminal: a pasted block's blank line never confirms, Ctrl+C
// writes nothing and makes no backup folder, a fresh Enter backs up and removes only the picked line.
test('a --drop run in a real terminal: a typed-ahead blank line never confirms, Ctrl+C writes nothing, a fresh Enter removes the pick', { skip: (process.platform !== 'linux' || spawnSync('script', ['--version']).status !== 0) && 'needs util-linux script on Linux' }, async t => {
  const pc = computer(t, { codex: false });
  fs.writeFileSync(path.join(pc.home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: ROOT }));
  const block = new permissions.PermissionBlocks({ home: pc.home, environment: {}, cwd: os.tmpdir() }).build({ host: 'claude', scope: 'computer' }).blocks[0];
  const gone = `Bash(python ${path.join(pc.home, 'scratch', 'gone.py')})`;
  fs.mkdirSync(path.dirname(pc.settings), { recursive: true });
  fs.writeFileSync(pc.settings, JSON.stringify({ permissions: { allow: [...block.allow, gone, 'Bash(npm test)'], ask: block.ask }, autoMode: { allow: ['$defaults', ...permissions.AUTO_MODE_ALLOW] } }));
  const before = fs.readFileSync(pc.settings, 'utf8');
  const listed = [];
  assert.equal(cli.main(['--review', '--drop', 'D1', '--json'], { home: pc.home, environment: {}, cwd: os.tmpdir(), stdout: text => listed.push(text) }), 0);
  const { preview } = JSON.parse(listed.join(''));
  const env = { PATH: process.env.PATH, HOME: pc.home, TERM: 'dumb', LANG: 'C.UTF-8' };
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions.cjs'))} --apply --host claude --drop D1 --preview ${preview}`;
  const run = key => new Promise(resolve => {
    const child = require('node:child_process').spawn('script', ['-qec', command, '/dev/null'], { env, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let typed = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('close', code => { clearTimeout(timer); child.stdin.destroy(); resolve({ code, output }); });
    child.stdin.write('\r');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!typed && /Press Enter to back up and write 1 file/.test(output)) { typed = true; setTimeout(() => child.stdin.write(key), 1500); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
  });
  const stopped = await run('\x03');
  assert.equal(stopped.code, 1, stopped.output);
  assert.match(stopped.output, /remove {2}D1 python \.\.\.\/gone\.py/);
  assert.match(stopped.output, /Stopped\. Nothing was written\./);
  assert.equal(fs.readFileSync(pc.settings, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(pc.home, '.ai-agent-toolkit', 'backups')), false, 'no backup folder on Ctrl+C');
  const { code, output } = await run('\r');
  assert.equal(code, 0, output);
  assert.match(output, /Done: 1 file written, 0 lines added, 1 removed\./);
  const after = JSON.parse(fs.readFileSync(pc.settings, 'utf8')).permissions.allow;
  assert.ok(!after.includes(gone) && after.includes('Bash(npm test)'), 'only the picked line went');
  assert.equal(fs.readdirSync(path.join(pc.home, '.ai-agent-toolkit', 'backups', 'permissions')).length, 1);
});

// G2 round 1, L6 and L9: the CLI runs as a script only when toolkit-permissions.cjs started it (the file
// its ask line names); toolkit-permissions.cjs never drops a test's deps for the CLI flags.
test('the CLI refuses to run as a script on its own; test deps never reach the real files', t => {
  const pc = computer(t, { codex: false });
  const direct = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-permissions-cli.cjs'), '--apply'], { encoding: 'utf8', input: '', env: { PATH: process.env.PATH, HOME: pc.home, USERPROFILE: pc.home }, cwd: os.tmpdir() });
  assert.equal(direct.status, 2, direct.stderr);
  assert.match(direct.stderr, /run this through toolkit-permissions\.cjs/);
  for (const flag of ['--review', '--apply', '--remove']) assert.throws(() => permissions.main([flag], pc.deps), /runs in toolkit-permissions-cli\.cjs: call its main with these deps/, flag);
  assert.equal(fs.existsSync(pc.settings), false);
});
