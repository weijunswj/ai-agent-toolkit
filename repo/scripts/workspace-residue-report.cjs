#!/usr/bin/env node
'use strict';

// Lists the worktrees and local branches a checkout still holds after their work merged, so the
// owner can see what is left and decide what to remove. Read only: it runs git queries, reads no
// file contents itself and deletes nothing. Paths are shown relative to the primary checkout.
//
//   node repo/scripts/workspace-residue-report.cjs [--repo <checkout>] [--base <ref>] [--json]
//
// --repo defaults to the current folder, --base to origin/main (fetch first for a current answer).
// A worktree or branch is "ready to remove" when it is clean, unlocked, holds no ignored files (git
// worktree remove deletes those too) and its commit is already in the base; everything else says why
// it needs a look first. The default branch is never offered. Worktrees a host made (Claude Code's
// .claude/worktrees, Codex's worktrees folder) are listed but left to the host's own clean-up.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const USAGE = 'Usage: node repo/scripts/workspace-residue-report.cjs [--repo <checkout>] [--base <ref>] [--json]';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { repo: process.cwd(), base: 'origin/main', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo' || arg === '--base') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
      index += 1;
      options[arg.slice(2)] = value;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`Unknown argument ${arg}.`);
  }
  return options;
}

// git with optional locks off, so a status query never rewrites the index of a worktree it looks at.
function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return { ok: result.status === 0, stdout: result.stdout || '', stderr: (result.stderr || '').trim() };
}

function parseWorktrees(porcelain) {
  const worktrees = [];
  let current = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), head: null, branch: null, locked: false, prunable: false };
      worktrees.push(current);
    } else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  return worktrees;
}

function placeOf(worktreePath, primary) {
  const rel = path.relative(primary, worktreePath).replace(/\\/g, '/');
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    if (rel.startsWith('.tmp/worktrees/')) return 'repo .tmp/worktrees';
    if (rel.startsWith('.claude/worktrees/')) return 'Claude Code';
    return 'inside the checkout';
  }
  if (/[\\/]\.codex[\\/]worktrees[\\/]/.test(worktreePath)) return 'Codex';
  return 'outside the checkout';
}

// The base's own branch name and the remote's default branch, never offered for removal.
function defaultBranches(repo, base) {
  const remotes = git(repo, ['remote']).stdout.split('\n').filter(Boolean);
  const short = base.replace(/^refs\/(heads|remotes)\//, '');
  const owner = remotes.find((remote) => short.startsWith(`${remote}/`));
  const names = new Set([owner ? short.slice(owner.length + 1) : short]);
  // A base given as a commit or tag names no branch, and a remote added by hand has no HEAD, so the
  // usual default names are always kept too.
  names.add('main');
  names.add('master');
  const configured = git(repo, ['config', '--get', 'init.defaultBranch']).stdout.trim();
  if (configured) names.add(configured);
  for (const remote of remotes) {
    const head = git(repo, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
    if (head.ok) names.add(head.stdout.trim().slice(remote.length + 1));
  }
  return names;
}

// A path relative to the primary checkout, with forward slashes, so no home folder is printed. A
// worktree on another drive stays absolute, with the home folder shown as ~.
function shown(primary, target) {
  let shownPath = path.relative(primary, path.resolve(target));
  const home = os.homedir();
  if (path.isAbsolute(shownPath) && shownPath.toLowerCase().startsWith(home.toLowerCase())) shownPath = `~${shownPath.slice(home.length)}`;
  return shownPath.replace(/\\/g, '/') || '.';
}

function inBase(repo, commit, base) {
  return git(repo, ['merge-base', '--is-ancestor', commit, base]).ok;
}

// Builds the report for one checkout. Throws UsageError when the folder is not a checkout or the base is unknown.
function collect(repo, base) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new UsageError(`${repo} is not a git checkout.`);
  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) throw new UsageError(`The base ${base} is not known here. Fetch it first or pass --base.`);
  const listed = parseWorktrees(git(repo, ['worktree', 'list', '--porcelain']).stdout);
  const primary = path.resolve(listed.length ? listed[0].path : top.stdout.trim());
  const worktrees = listed.slice(1).map((item) => {
    const exists = fs.existsSync(item.path);
    const place = placeOf(item.path, primary);
    const host = place === 'Claude Code' || place === 'Codex';
    // Names of changed and ignored files are counted, never read.
    const status = exists ? git(item.path, ['status', '--porcelain', '--untracked-files=normal', '--ignored=matching']) : null;
    const lines = status && status.ok ? status.stdout.split('\n').filter(Boolean) : null;
    const changes = lines ? lines.filter((line) => !line.startsWith('!! ')).length : null;
    const ignored = lines ? lines.length - changes : null;
    const merged = item.head ? inBase(repo, item.head, base) : false;
    const reasons = [];
    if (!exists) reasons.push('folder is gone (git worktree prune clears the record)');
    if (item.locked) reasons.push('locked');
    if (exists && changes === null) reasons.push('status unreadable');
    if (changes) reasons.push(`${changes} uncommitted change(s)`);
    if (ignored) reasons.push(`${ignored} ignored item(s) that git worktree remove deletes`);
    if (!merged) reasons.push(`commit not in ${base}`);
    if (host) reasons.push('host-made, left to the host');
    return { ...item, path: shown(primary, item.path), place, exists, changes, ignored, merged, ready: reasons.length === 0, reasons };
  });
  const inUse = new Set(listed.map((item) => item.branch).filter(Boolean));
  const current = git(repo, ['branch', '--show-current']).stdout.trim();
  const names = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.split('\n').filter(Boolean);
  const defaults = defaultBranches(repo, base);
  const branches = names.filter((name) => name !== current).map((name) => {
    const merged = inBase(repo, `refs/heads/${name}`, base);
    const reasons = [];
    if (defaults.has(name)) reasons.push('default branch, keep');
    if (inUse.has(name)) reasons.push('checked out in a worktree');
    if (!merged) reasons.push(`not merged into ${base}`);
    return { name, merged, ready: reasons.length === 0, reasons };
  });
  return { schema: 'toolkit-workspace-residue/v1', repo: path.basename(primary), base, worktrees, branches };
}

function render(report) {
  const lines = [`Workspace residue in ${report.repo} (against ${report.base}). Nothing was changed.`];
  const section = (title, items, label) => {
    lines.push('', `${title}: ${items.length}`);
    for (const item of items) lines.push(`- ${item.ready ? 'ready to remove' : 'look first'}: ${label(item)}${item.reasons.length ? ` (${item.reasons.join('; ')})` : ''}`);
  };
  section('Extra worktrees', report.worktrees, (item) => `${item.path} [${item.branch || 'detached'}, ${item.place}]`);
  section('Local branches other than the current one', report.branches, (item) => item.name);
  lines.push('', 'To remove a ready worktree: git worktree remove <path>, then git worktree prune. A ready branch: git branch -d <name>. Never --force or -D.');
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) { out.write(`${USAGE}\n`); return 0; }
    const report = collect(path.resolve(options.repo), options.base);
    out.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : render(report));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) { err.write(`${error.message}\n${USAGE}\n`); return 2; }
    throw error;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ collect, main, parseArgs, parseWorktrees, render });
