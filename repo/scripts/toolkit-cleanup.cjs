#!/usr/bin/env node
'use strict';

// `toolkit cleanup`: removes rebuildable scraps, and only those. Everything it will not remove is
// reported for the owner; nothing outside a scratch root is ever touched.
//
//   node repo/scripts/toolkit-cleanup.cjs plan  [--repo-root <checkout>] [--path <scrap>]... [--stale]
//                                               [--branch <name>]... [--store <evidence store checkout>] [--json]
//   node repo/scripts/toolkit-cleanup.cjs apply (same options)
//
// plan is read-only. apply removes what plan would list as `remove`, after the evidence store
// read-back passes; when the read-back fails, nothing is deleted and the line says why.
//
// Scratch roots (nothing else is ever in scope):
//   <main checkout>/.tmp/                       including .tmp/worktrees/
//   ~/.ai-agent-toolkit/user-state/tmp/
//   <OS temp>/ai-agent-toolkit-<name>/          only when named with --path, never the temp folder itself
//
// --path names your own scraps. --stale takes entries in the first two roots untouched for 7 days.
// A scrap is removed only when all of this holds; otherwise it is kept and reported:
//   - its path is inside a scratch root, before and after every link is resolved;
//   - it is not a link, and (for a folder) holds no link and no Git checkout of its own;
//   - inside a repository, Git ignores it and tracks nothing in it;
//   - a worktree is registered, unlocked, clean including ignored files, and its commit is on a
//     remote; it is removed with `git worktree remove` (never --force), then `git worktree prune`.
// --branch deletes a local branch with `git branch -d`, only when it is fully in the default
// branch on the remote, is not the default branch and no worktree has it checked out.
// It never deletes a remote branch, a file outside the roots, a dirty or unpushed worktree, or a
// task or setting. It prints paths and counts only, never file contents.
//
// Exit codes: 0 done (kept items are listed), 1 stopped or a removal failed, 2 usage.

const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { githubSlug } = require('./toolkit-permissions.cjs');

const STALE_DAYS = 7;
const WALK_LIMIT = 50000;
const TEMP_NAME = /^ai-agent-toolkit-[A-Za-z0-9._-]+$/;
const BRANCH = /^(?![-/.])[A-Za-z0-9._/-]{1,200}(?<![/.])$/;

class CleanupError extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; }
}

// True when `child` is `parent` or inside it, by path text alone.
function within(parent, child, { strict = false } = {}) {
  const relative = path.relative(parent, child);
  if (relative === '') return !strict;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

class ScratchCleaner {
  #fs; #run; #home; #tmpdir; #cwd; #now;

  constructor({ fs = nodeFs, run = spawnSync, home = os.homedir(), tmpdir = os.tmpdir(), cwd = process.cwd(), now = () => new Date() } = {}) {
    this.#fs = fs; this.#run = run; this.#home = home; this.#tmpdir = tmpdir; this.#cwd = cwd; this.#now = now;
  }

  #git(cwd, args, { timeout = 30000 } = {}) {
    const result = this.#run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, windowsHide: true });
    return { ok: Boolean(result) && result.status === 0, status: result ? result.status : null, out: String(result?.stdout || ''), err: String(result?.stderr || '').trim().split(/\r?\n/)[0] };
  }

  #real(target) { try { return this.#fs.realpathSync(target); } catch { return null; } }
  #lstat(target) { try { return this.#fs.lstatSync(target); } catch { return null; } }

  // The main checkout of the repository the run is for, or null outside a repository.
  mainCheckout(repoRoot) {
    const start = path.resolve(repoRoot || this.#cwd);
    const common = this.#git(start, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common.ok) return null;
    const dir = common.out.trim();
    return path.basename(dir) === '.git' ? path.dirname(dir) : null;
  }

  roots(main) {
    return [
      ...(main ? [{ kind: 'repo', dir: path.join(main, '.tmp') }] : []),
      { kind: 'state', dir: path.join(this.#home, '.ai-agent-toolkit', 'user-state', 'tmp') },
      { kind: 'temp', dir: path.resolve(this.#tmpdir) },
    ];
  }

  // The scratch root a path belongs to, by text and then with links resolved. { root } or { refuse }.
  #rootOf(target, roots) {
    const root = roots.find(candidate => within(candidate.dir, target, { strict: true }));
    if (!root) return { refuse: 'it is outside every scratch root' };
    if (root.kind === 'temp') {
      const first = path.relative(root.dir, target).split(path.sep)[0];
      if (!TEMP_NAME.test(first)) return { refuse: 'in the OS temp folder only a folder named ai-agent-toolkit-<name> is in scope' };
    }
    const realRoot = this.#real(root.dir);
    const realParent = this.#real(path.dirname(target));
    if (!realRoot || !realParent) return { refuse: 'its folder could not be resolved' };
    const realTarget = path.join(realParent, path.basename(target));
    if (!within(realRoot, realTarget, { strict: true })) return { refuse: 'a link in its path leads outside the scratch root' };
    if (root.kind === 'temp' && !TEMP_NAME.test(path.relative(realRoot, realTarget).split(path.sep)[0])) return { refuse: 'a link in its path leads outside the Toolkit temp folder' };
    return { root };
  }

  // Walks a folder without following links. { files, reason } where reason, when set, is why it is kept.
  #walk(dir) {
    let files = 0, seen = 0;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      let names;
      try { names = this.#fs.readdirSync(current); } catch { return { files, reason: 'part of it could not be read' }; }
      for (const name of names) {
        if ((seen += 1) > WALK_LIMIT) return { files, reason: `it holds more than ${WALK_LIMIT} entries` };
        const full = path.join(current, name);
        const stat = this.#lstat(full);
        if (!stat) return { files, reason: 'part of it could not be read' };
        if (name === '.git') return { files, reason: 'it holds a Git checkout, which may carry work that exists nowhere else' };
        if (stat.isSymbolicLink()) return { files, reason: 'it holds a link, which could lead outside the scratch root' };
        if (stat.isDirectory()) stack.push(full); else files += 1;
      }
    }
    return { files, reason: null };
  }

  #newest(target, stat) {
    let newest = stat.mtimeMs;
    if (!stat.isDirectory()) return newest;
    let names = [];
    try { names = this.#fs.readdirSync(target); } catch { return Infinity; }
    for (const name of names.slice(0, 2000)) { const inner = this.#lstat(path.join(target, name)); if (!inner) return Infinity; newest = Math.max(newest, inner.mtimeMs); }
    return newest;
  }

  #worktrees(main) {
    const listed = this.#git(main, ['worktree', 'list', '--porcelain']);
    if (!listed.ok) return null;
    return listed.out.split(/\r?\n\r?\n/).map(block => {
      const entry = { path: null, branch: null, locked: false };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) entry.path = path.resolve(line.slice(9));
        else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true;
      }
      return entry;
    }).filter(entry => entry.path);
  }

  // One scrap: { path, action: 'remove'|'keep'|'refuse'|'gone', kind, reason, files }.
  classify(input, { main, roots, worktrees }) {
    const target = path.resolve(input);
    const item = { path: target, action: 'keep', kind: 'file', reason: null, files: 0 };
    const placed = this.#rootOf(target, roots);
    if (placed.refuse) return { ...item, action: 'refuse', reason: placed.refuse };
    const stat = this.#lstat(target);
    if (!stat) return { ...item, action: 'gone', reason: 'already gone' };
    if (stat.isSymbolicLink()) return { ...item, reason: 'it is a link; Toolkit never deletes through or around a link' };
    if (within(target, path.resolve(this.#cwd))) return { ...item, reason: 'this session is working inside it' };
    if (placed.root.kind === 'repo') {
      const tracked = this.#git(main, ['ls-files', '--', target]);
      if (!tracked.ok || tracked.out.trim()) return { ...item, reason: 'Git tracks files in it' };
      if (!this.#git(main, ['check-ignore', '-q', '--', target]).ok) return { ...item, reason: 'Git does not ignore it, so it may be real work' };
    }
    const pointer = stat.isDirectory() ? this.#lstat(path.join(target, '.git')) : null;
    if (pointer) {
      item.kind = 'worktree';
      const known = pointer.isFile() && main && (worktrees || []).find(entry => this.#real(entry.path) === this.#real(target));
      if (!known) return { ...item, reason: 'it is a Git checkout that is not a registered worktree of this repository' };
      if (known.locked) return { ...item, reason: 'the worktree is locked' };
      const status = this.#git(target, ['status', '--porcelain', '--ignored']);
      if (!status.ok) return { ...item, reason: 'its state could not be read' };
      const lines = status.out.split(/\r?\n/).filter(Boolean);
      if (lines.some(line => !line.startsWith('!! '))) return { ...item, reason: 'it has uncommitted changes or untracked files' };
      if (lines.length) return { ...item, reason: 'it holds ignored files, which removal would delete' };
      const pushed = this.#git(target, ['for-each-ref', '--contains', 'HEAD', '--count=1', '--format=%(refname)', 'refs/remotes']);
      if (!pushed.ok || !pushed.out.trim()) return { ...item, reason: 'its commit is not on any remote' };
      return { ...item, action: 'remove', branch: known.branch };
    }
    if (stat.isDirectory()) {
      item.kind = 'folder';
      const walked = this.#walk(target);
      item.files = walked.files;
      if (walked.reason) return { ...item, reason: walked.reason };
    } else if (!stat.isFile()) return { ...item, reason: 'it is not an ordinary file or folder' };
    else item.files = 1;
    return { ...item, action: 'remove' };
  }

  classifyBranch(name, { main, worktrees }) {
    const item = { branch: name, action: 'keep', kind: 'branch', reason: null };
    if (!BRANCH.test(name) || name.includes('..')) return { ...item, action: 'refuse', reason: 'that is not a plain branch name' };
    if (!main) return { ...item, action: 'refuse', reason: 'this folder is not inside a repository' };
    if (!this.#git(main, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).ok) return { ...item, action: 'gone', reason: 'already gone' };
    const head = this.#git(main, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    const base = head.ok ? head.out.trim() : null;
    if (!base) return { ...item, reason: 'the default branch on the remote is not known here (run git remote set-head origin --auto)' };
    if (name === base.replace(/^origin\//, '')) return { ...item, reason: 'it is the default branch' };
    if ((worktrees || []).some(entry => entry.branch === name)) return { ...item, reason: 'a worktree has it checked out' };
    if (!this.#git(main, ['merge-base', '--is-ancestor', `refs/heads/${name}`, `refs/remotes/${base}`]).ok) return { ...item, reason: `it is not fully in ${base}` };
    return { ...item, action: 'remove' };
  }

  #staleCandidates(roots) {
    const cutoff = this.#now().getTime() - STALE_DAYS * 24 * 60 * 60 * 1000;
    const found = [];
    const children = dir => { try { return this.#fs.readdirSync(dir).map(name => path.join(dir, name)); } catch { return []; } };
    for (const root of roots.filter(candidate => candidate.kind !== 'temp')) {
      for (const entry of children(root.dir)) {
        const expand = root.kind === 'repo' && path.basename(entry) === 'worktrees' && this.#lstat(entry)?.isDirectory() && !this.#lstat(entry).isSymbolicLink();
        for (const candidate of expand ? children(entry) : [entry]) {
          const stat = this.#lstat(candidate);
          if (stat && this.#newest(candidate, stat) < cutoff) found.push(candidate);
        }
      }
    }
    return found;
  }

  // The evidence store read-back: its checkout is the bound store, clean, and fully on the remote.
  readBack(main, storePath) {
    let binding = null;
    try { binding = main ? JSON.parse(this.#fs.readFileSync(path.join(main, '.github', 'toolkit-programme.json'), 'utf8').replace(/^﻿/, '')) : null; } catch { binding = null; }
    const store = binding?.store?.kind === 'github' && typeof binding.store.repository === 'string' ? binding.store : null;
    if (!store) return { ok: true, note: 'no evidence store is bound here, so there was nothing to read back' };
    if (!storePath) return { ok: false, reason: 'this repository has an evidence store and no --store <folder> was given' };
    const dir = path.resolve(storePath);
    if (githubSlug(this.#git(dir, ['remote', 'get-url', 'origin']).out) !== store.repository.toLowerCase()) return { ok: false, reason: 'that folder is not a checkout of the bound evidence store' };
    const branch = typeof store.branch === 'string' && BRANCH.test(store.branch) ? store.branch : 'main';
    if (!this.#git(dir, ['fetch', '--quiet', 'origin', branch], { timeout: 120000 }).ok) return { ok: false, reason: 'the evidence store could not be fetched' };
    const status = this.#git(dir, ['status', '--porcelain']);
    if (!status.ok || status.out.trim()) return { ok: false, reason: 'the evidence store checkout has changes that are not committed' };
    if (!this.#git(dir, ['merge-base', '--is-ancestor', 'HEAD', `refs/remotes/origin/${branch}`]).ok) return { ok: false, reason: 'the evidence store checkout has commits that are not on the remote' };
    return { ok: true, note: 'evidence store read back' };
  }

  plan({ repoRoot = null, paths = [], stale = false, branches = [] } = {}) {
    const main = this.mainCheckout(repoRoot);
    const roots = this.roots(main);
    const worktrees = main ? this.#worktrees(main) : null;
    const wanted = [...new Set([...paths.map(entry => path.resolve(entry)), ...(stale ? this.#staleCandidates(roots) : [])])];
    return {
      main, roots: roots.map(root => root.dir),
      items: wanted.map(target => this.classify(target, { main, roots, worktrees })),
      branches: [...new Set(branches)].map(name => this.classifyBranch(name, { main, worktrees })),
    };
  }

  apply(options = {}) {
    const planned = this.plan(options);
    const result = { ...planned, read_back: null, cleaned: { worktrees: 0, files: 0, folders: 0, branches: 0 }, failed: [] };
    const todo = [...planned.items, ...planned.branches].filter(item => item.action === 'remove');
    if (!todo.length) return result;
    result.read_back = this.readBack(planned.main, options.storePath || null);
    if (!result.read_back.ok) return result;
    const worktrees = planned.main ? this.#worktrees(planned.main) : null;
    const roots = this.roots(planned.main);
    for (const item of planned.items.filter(entry => entry.action === 'remove')) {
      // Checked again just before the delete, so a scrap that changed since the plan is kept.
      const fresh = this.classify(item.path, { main: planned.main, roots, worktrees });
      if (fresh.action !== 'remove' || fresh.kind !== item.kind) { Object.assign(item, { action: 'keep', reason: fresh.reason || 'it changed while cleanup ran' }); continue; }
      try {
        if (item.kind === 'worktree') {
          const removed = this.#git(planned.main, ['worktree', 'remove', '--', item.path]);
          if (!removed.ok) throw new Error(removed.err || 'git refused to remove the worktree');
          result.cleaned.worktrees += 1;
        } else {
          this.#fs.rmSync(item.path, { recursive: item.kind === 'folder', force: false, maxRetries: 3, retryDelay: 200 });
          result.cleaned.files += item.files;
          if (item.kind === 'folder') result.cleaned.folders += 1;
        }
        item.action = 'removed';
      } catch (error) {
        item.action = 'failed'; item.reason = String(error.code || error.message).slice(0, 200);
        result.failed.push(item.path);
      }
    }
    if (result.cleaned.worktrees) this.#git(planned.main, ['worktree', 'prune']);
    const after = planned.main ? this.#worktrees(planned.main) : null;
    for (const item of planned.branches.filter(entry => entry.action === 'remove')) {
      const fresh = this.classifyBranch(item.branch, { main: planned.main, worktrees: after });
      if (fresh.action !== 'remove') { Object.assign(item, { action: 'keep', reason: fresh.reason }); continue; }
      const removed = this.#git(planned.main, ['branch', '-d', '--', item.branch]);
      if (removed.ok) { item.action = 'removed'; result.cleaned.branches += 1; } else { item.action = 'failed'; item.reason = removed.err || 'git refused'; result.failed.push(item.branch); }
    }
    return result;
  }
}

// ---- command line --------------------------------------------------------------------------------

const USAGE = 'Usage: node repo/scripts/toolkit-cleanup.cjs plan|apply [--repo-root <checkout>] [--path <scrap>]... [--stale] [--branch <name>]... [--store <evidence store checkout>] [--json]\n';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['plan', 'apply'].includes(command)) throw new CleanupError('give a command: plan or apply.', 'see the usage line.', 2);
  const options = { command, json: false, stale: false, paths: [], branches: [], repoRoot: null, storePath: null };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--stale') { options.stale = true; continue; }
    const value = ['--repo-root', '--path', '--branch', '--store'].includes(arg) ? rest[index += 1] : undefined;
    if (value === undefined || value.startsWith('--')) throw new CleanupError(`unknown or incomplete argument ${JSON.stringify(arg)}.`, 'see the usage line.', 2);
    if (arg === '--path') options.paths.push(value);
    else if (arg === '--branch') options.branches.push(value);
    else if (arg === '--repo-root') options.repoRoot = value;
    else options.storePath = value;
  }
  if (!options.paths.length && !options.stale && !options.branches.length) throw new CleanupError('nothing was named to clean.', 'name your scraps with --path, a merged branch with --branch, or use --stale.', 2);
  return options;
}

function describe(result, applied) {
  const every = [...result.items, ...result.branches];
  const label = item => item.path || `branch ${item.branch}`;
  const lines = [];
  if (applied) {
    const c = result.cleaned;
    const parts = [[c.worktrees, 'worktree'], [c.files, 'temp file'], [c.branches, 'merged branch']].filter(([count]) => count).map(([count, word]) => `${count} ${word}${count === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`);
    if (result.read_back && !result.read_back.ok) lines.push(`Stopped: nothing was deleted, because ${result.read_back.reason}. Next: commit and push the evidence store, then run cleanup again with --store <its folder>.`);
    else lines.push(`cleaned: ${parts.length ? parts.join(', ') : 'nothing'}${result.read_back?.note ? ` (${result.read_back.note})` : ''}`);
  } else {
    lines.push(...every.filter(item => item.action === 'remove').map(item => `- would remove (${item.kind}): ${label(item)}`));
    if (!every.some(item => item.action === 'remove')) lines.push('Nothing here can be removed without asking.');
  }
  lines.push(...every.filter(item => item.action === 'keep').map(item => `- kept, ask the owner: ${label(item)}: ${item.reason}`));
  lines.push(...every.filter(item => item.action === 'refuse').map(item => `- refused: ${label(item)}: ${item.reason}`));
  lines.push(...every.filter(item => item.action === 'failed').map(item => `- could not remove: ${label(item)}: ${item.reason}`));
  return lines;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  let options;
  try { options = parseArgs(argv); }
  catch (error) { err(`${error.message}\n${USAGE}`); return 2; }
  const cleaner = new ScratchCleaner(deps);
  const applied = options.command === 'apply';
  const result = applied ? cleaner.apply(options) : cleaner.plan(options);
  out(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${describe(result, applied).join('\n')}\n`);
  return applied && (result.failed.length || (result.read_back && !result.read_back.ok)) ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ ScratchCleaner, CleanupError, within, parseArgs, main, STALE_DAYS, TEMP_NAME });
