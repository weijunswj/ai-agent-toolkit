'use strict';

// A fake computer and governed repository for the permission review and --apply tests, in the shapes
// found on a real computer: the computer settings file with Toolkit's block (two lines missing), web,
// MCP and scratch-script lines; a repository "automation" whose local settings hold broad, dead and
// own lines; three worktree copies of that file; and a shared settings file in Git.
//
// The repository lives at the POSIX path /work/automation as the Linux computer sees it; every file
// call under that path goes to a real temporary folder, so the tests run the same on Windows. Toolkit
// sits at /opt/toolkit, read from this checkout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TK = '/opt/toolkit';
const VROOT = '/work/automation';
const slashed = file => String(file).replace(/\\/g, '/');
const ENABLED_BINDING = Object.freeze({ schema: 'toolkit.programme-binding.v2', repository: 'Owner/automation', governance: 'enabled', parents: [{ issue: 7, record_prefix: 'TEST-' }], store: { kind: 'github', repository: 'Owner/Store', branch: 'main', path: 'state/' }, required_checks: [] });

// The lines, as the walk found them (paths are fixture paths).
const COMPUTER_OTHER = Object.freeze(['WebFetch', 'WebSearch', 'mcp__scheduled-tasks__list_scheduled_tasks', 'mcp__scheduled-tasks__create_scheduled_task',
  'Bash(python -I /work/scratch/scan-old.py)', 'Bash(python -I /work/automation/tools/report.py *)']);
const REPO_OTHER = Object.freeze(['Bash(gh api *)', "Bash(python -c ' *)",
  'Bash(bash /work/scratch/probe-a.sh)', 'Bash(bash /work/scratch/probe-b.sh)', 'Bash(cp /work/scratch/out.json /work/automation/out.json)',
  'Bash(python /work/scratch/check.py)', 'Bash(cat /work/scratch/run-1.log)', 'Bash(cat /work/scratch/run-2.log)', 'Bash(cygpath -w /work/scratch/tmp)',
  'Bash(git fetch *)', 'Bash(git ls-remote *)', 'Read(//work/automation/docs/**)', 'Bash(grep -n TODO /work/automation/README.md)',
  'Bash(tasklist)', 'Bash(DEPLOY_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789ABCD node /work/automation/tools/ping.js)']);

function setup(t, { codex = false, answer = true, copies = 3, shared = true, computerMissing = 2 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-fix-'));
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-perm-repo-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(real, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: TK }));
  if (codex) fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(real, '.github'), { recursive: true });
  fs.writeFileSync(path.join(real, '.github', 'toolkit-programme.json'), JSON.stringify(ENABLED_BINDING));
  for (const folder of ['tools', 'docs']) fs.mkdirSync(path.join(real, folder), { recursive: true });
  fs.writeFileSync(path.join(real, 'tools', 'report.py'), '');
  fs.writeFileSync(path.join(real, 'tools', 'ping.js'), '');
  fs.writeFileSync(path.join(real, 'README.md'), '');
  const worktrees = Array.from({ length: copies }, (_, index) => `${VROOT}/.claude/worktrees/wt-${String.fromCharCode(97 + index)}`);
  for (const tree of worktrees) fs.mkdirSync(path.join(real, tree.slice(VROOT.length), '.claude'), { recursive: true });

  const map = arg => {
    if (typeof arg !== 'string') return arg;
    const text = slashed(arg).replace(/^[A-Za-z]:(?=\/)/, '');
    if (text === VROOT || text.startsWith(`${VROOT}/`)) return path.join(real, text.slice(VROOT.length));
    if (text.startsWith(`${TK}/`)) return path.join(ROOT, text.slice(TK.length + 1));
    return arg;
  };
  const fixFs = new Proxy(fs, { get: (target, name) => (typeof target[name] === 'function' ? (...args) => target[name](...args.map(map)) : target[name]) });
  let registered = worktrees.slice(0, Math.max(0, copies - 1)); // the last copy's folder is left over, not registered
  const run = (cmd, args) => {
    const where = slashed(args[1]).replace(/^[A-Za-z]:(?=\/)/, '');
    const rest = args.slice(2).join(' ');
    if (where !== VROOT && !where.startsWith(`${VROOT}/`)) return { status: 1, stdout: '' };
    if (rest === 'rev-parse --path-format=absolute --git-common-dir') return { status: 0, stdout: `${VROOT}/.git\n` };
    if (rest === 'worktree list --porcelain') return { status: 0, stdout: [VROOT, ...registered].map(tree => `worktree ${tree}\nHEAD 0000000\nbranch refs/heads/x\n`).join('\n') };
    if (rest === 'ls-files --error-unmatch .claude/settings.json') return { status: shared ? 0 : 1, stdout: shared ? '.claude/settings.json\n' : '' };
    return { status: 1, stdout: '' };
  };
  const out = [];
  const err = [];
  const asked = [];
  const deps = {
    home, platform: 'linux', environment: {}, cwd: VROOT, fs: fixFs, run, now: () => new Date('2026-11-26T10:15:00Z'),
    tty: () => ({ stdin: true, stdout: true }), confirm: effect => { asked.push(effect); return typeof answer === 'function' ? answer(effect) : answer; },
    stdout: text => out.push(text), stderr: text => err.push(text),
  };
  const files = {
    computer: path.join(home, '.claude', 'settings.json'),
    repo: path.join(real, '.claude', 'settings.local.json'),
    shared: path.join(real, '.claude', 'settings.json'),
    copies: worktrees.map(tree => path.join(real, tree.slice(VROOT.length), '.claude', 'settings.local.json')),
  };
  const write = (file, value, { indent = 2, eol = '\n', bom = false } = {}) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${bom ? '﻿' : ''}${JSON.stringify(value, null, indent).replace(/\n/g, eol)}${eol}`);
  };
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  return { home, real, root: VROOT, deps, out, err, asked, files, write, read, worktrees, setRegistered: list => { registered = list; } };
}

// Writes the walk's shapes: Toolkit's computer block less `computerMissing` lines (the gate-session
// pair), the computer's other lines, the repository's lines in its local file and every copy, and
// the shared file's web lines.
function populate(fix, { computerMissing = 2, permissions } = {}) {
  const built = new permissions.PermissionBlocks(fix.deps).build({ host: 'claude', scope: 'all', repoRoot: fix.root });
  const computer = built.blocks.find(block => block.scope === 'computer');
  const repo = built.blocks.find(block => block.scope === 'repo');
  const leaveOut = computer.allow.filter(line => / gate-session /.test(line)).slice(0, computerMissing);
  fix.write(fix.files.computer, { model: 'opus', env: { A: '1' }, autoMode: { allow: ['keep this'] }, permissions: { allow: [...computer.allow.filter(line => !leaveOut.includes(line)), ...COMPUTER_OTHER], ask: computer.ask, deny: ['Bash(rm -rf /)'], defaultMode: 'default' } }, { indent: 4, eol: '\r\n', bom: true });
  fix.write(fix.files.repo, { permissions: { allow: [...REPO_OTHER] } });
  for (const copy of fix.files.copies) fix.write(copy, { permissions: { allow: [...REPO_OTHER] } });
  fix.write(fix.files.shared, { permissions: { allow: ['WebFetch', 'WebSearch'] } });
  return { built, computer, repo, leaveOut };
}

module.exports = Object.freeze({ setup, populate, TK, VROOT, ENABLED_BINDING, COMPUTER_OTHER, REPO_OTHER, slashed });
