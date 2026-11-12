#!/usr/bin/env node
'use strict';

// `toolkit cleanup`: removes rebuildable scraps, and only those. Everything it will not remove is
// reported for the owner; nothing outside a scratch root is ever touched.
//
//   node repo/scripts/toolkit-cleanup.cjs plan  [--repo-root <checkout>] [--path <scrap>]... [--stale]
//                                               [--branch <name>]... [--store <evidence store checkout>] [--json]
//   node repo/scripts/toolkit-cleanup.cjs apply (same options)
//
// plan is read-only. apply removes what plan would list as `remove`, and only after the evidence
// store read-back passes. With no store to read back (no governed repository, no binding, no
// --store), or a failed read-back, nothing is deleted and the line says why. --repo-root may not
// name a different repository from the one the session is in.
//
// Scratch roots (nothing else is ever in scope):
//   <main checkout>/.tmp/                       including .tmp/worktrees/
//   ~/.ai-agent-toolkit/user-state/tmp/
//   <OS temp>/ai-agent-toolkit-<name>/          only when named with --path, never the temp folder itself
//
// --path names your own scraps. --stale takes entries in the first two roots untouched for 7 days.
// A scrap is removed only when all of this holds; otherwise it is kept and reported:
//   - its path is inside a scratch root, and no part of the path below that root is a link
//     (symlink or junction): the real path must be the typed path;
//   - it is not a link, and (for a folder) holds no link, no Git checkout and no bare repository;
//   - it is not inside a Git checkout (a worktree or a clone) or a bare repository, and no part of
//     its path is `.git` in any spelling: a checkout goes only whole, as a worktree, never piece
//     by piece;
//   - it is not at, inside or around a path Git lists as a worktree of this repository, unless it
//     is that whole worktree with its Git pointer file present;
//   - its scratch root is a real folder, not a link;
//   - inside a repository, Git ignores it and tracks nothing in it;
//   - its scratch root is not itself a Git checkout or repository, and when a repository above
//     the root contains it (a home folder kept in Git), that repository ignores it and tracks
//     nothing in it;
//   - a worktree is registered, unlocked, clean including every untracked and ignored file
//     (asked for by flag, so no Git setting can hide them), has no file marked assume-unchanged
//     or skip-worktree, and its commit is on a remote; it is removed with `git worktree remove`
//     (never --force), then `git worktree prune`.
// Git is run without the GIT_DIR family of environment variables, so it reads the folder it is
// pointed at and nothing else.
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

// How a checkout's state is read. Flags and -c beat any config, so a setting that hides untracked
// files, skips submodules or serves a cached answer cannot make unsaved work look clean.
const STATUS = Object.freeze(['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none']);
// Environment variables that would point Git at another repository, index or work tree.
const GIT_REDIRECTS = /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG_COUNT|CONFIG_PARAMETERS)$|^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i;

class CleanupError extends Error {
  constructor(stopped, next, exitCode = 1) { super(`Stopped: ${stopped} Next: ${next}`); this.exitCode = exitCode; }
}

// True when `child` is `parent` or inside it, by path text alone.
function within(parent, child, { strict = false } = {}) {
  const relative = path.relative(parent, child);
  if (relative === '') return !strict;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Windows paths ignore case; compare them the way the file system does.
const fold = text => (path.sep === '\\' ? text.toLowerCase() : text);
const isGitName = name => name.toLowerCase() === '.git';

class ScratchCleaner {
  #fs; #run; #home; #tmpdir; #cwd; #now;

  constructor({ fs = nodeFs, run = spawnSync, home = os.homedir(), tmpdir = os.tmpdir(), cwd = process.cwd(), now = () => new Date() } = {}) {
    this.#fs = fs; this.#run = run; this.#home = home; this.#tmpdir = tmpdir; this.#cwd = cwd; this.#now = now;
  }

  #git(cwd, args, { timeout = 30000 } = {}) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_REDIRECTS.test(name)));
    const result = this.#run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, windowsHide: true, env });
    return { ok: Boolean(result) && result.status === 0, status: result ? result.status : null, out: String(result?.stdout || ''), err: String(result?.stderr || '').trim().split(/\r?\n/)[0] };
  }

  // The operating system's own answer, which also expands Windows short (8.3) names.
  #real(target) { try { return (this.#fs.realpathSync.native || this.#fs.realpathSync)(target); } catch { return null; } }
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
      ...(main ? [{ kind: 'repo', base: main, dir: path.join(main, '.tmp') }] : []),
      { kind: 'state', base: this.#home, dir: path.join(this.#home, '.ai-agent-toolkit', 'user-state', 'tmp') },
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
    const parts = path.relative(root.dir, target).split(path.sep);
    if (parts.some(part => part.toLowerCase() === '.git')) return { refuse: 'part of its path is a Git folder; Toolkit never deletes inside one' };
    // A scratch root that is itself a link (or sits behind one) would send deletes somewhere else.
    if (root.kind !== 'temp') {
      const realBase = this.#real(root.base);
      const rootReal = this.#real(root.dir);
      if (rootReal && (!realBase || this.#lstat(root.dir)?.isSymbolicLink() || fold(rootReal) !== fold(path.join(realBase, path.relative(root.base, root.dir))))) return { refuse: 'its scratch root is a link, not a real folder' };
    }
    const realRoot = this.#real(root.dir);
    const realParent = this.#real(path.dirname(target));
    if (!realRoot || !realParent) return { refuse: 'its folder could not be resolved' };
    // The target's own name is resolved too (a short name is not its real name), unless it is a
    // link, which is judged as a link later and never followed.
    const own = this.#lstat(target);
    const realTarget = (own && !own.isSymbolicLink() && this.#real(target)) || path.join(realParent, path.basename(target));
    if (!within(realRoot, realTarget, { strict: true })) return { refuse: 'a link in its path leads outside the scratch root' };
    if (root.kind === 'temp' && !TEMP_NAME.test(path.relative(realRoot, realTarget).split(path.sep)[0])) return { refuse: 'a link in its path leads outside the Toolkit temp folder' };
    // A link below the root can point into a worktree or a clone, where Git in the main checkout
    // would call that checkout's unsaved work an ignored scrap. So the real path must be the typed one.
    for (let dir = path.dirname(target); within(root.dir, dir, { strict: true }); dir = path.dirname(dir)) {
      if (this.#lstat(dir)?.isSymbolicLink()) return { refuse: 'part of its path is a link; Toolkit never deletes through a link' };
    }
    if (fold(path.relative(realRoot, realTarget)) !== fold(path.relative(root.dir, target))) return { refuse: 'its path is not its real path (a link or a short name is in it); name it by its real path' };
    return { root, real: realTarget };
  }

  // True when a folder is laid out as a Git repository (a bare one, or the inside of `.git`).
  #repository(dir) {
    let names;
    try { names = this.#fs.readdirSync(dir).map(name => name.toLowerCase()); } catch { return false; }
    if (!['head', 'objects', 'refs'].every(name => names.includes(name))) return false;
    return Boolean(this.#lstat(path.join(dir, 'objects'))?.isDirectory() && this.#lstat(path.join(dir, 'refs'))?.isDirectory());
  }

  #holdsGit(dir) {
    try { return this.#fs.readdirSync(dir).some(isGitName); } catch { return true; }
  }

  // The `.git` entry of a folder as it is spelled on disk, or null.
  #gitName(dir) {
    try { return this.#fs.readdirSync(dir).find(isGitName) || null; } catch { return null; }
  }

  // Walks a folder without following links. { files, reason } where reason, when set, is why it is kept.
  #walk(dir) {
    let files = 0, seen = 0;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      let names;
      try { names = this.#fs.readdirSync(current); } catch { return { files, reason: 'part of it could not be read' }; }
      if (this.#repository(current)) return { files, reason: 'it holds a Git repository, which may carry commits that exist nowhere else' };
      for (const name of names) {
        if ((seen += 1) > WALK_LIMIT) return { files, reason: `it holds more than ${WALK_LIMIT} entries` };
        const full = path.join(current, name);
        const stat = this.#lstat(full);
        if (!stat) return { files, reason: 'part of it could not be read' };
        if (isGitName(name)) return { files, reason: 'it holds a Git checkout, which may carry work that exists nowhere else' };
        if (stat.isSymbolicLink()) return { files, reason: 'it holds a link, which could lead outside the scratch root' };
        if (stat.isDirectory()) stack.push(full); else files += 1;
      }
    }
    return { files, reason: null };
  }

  #newest(target, stat) {
    // The newest change anywhere inside, so live work nested deep down is never called stale.
    // Anything unreadable or too large counts as fresh.
    let newest = stat.mtimeMs, seen = 0;
    if (!stat.isDirectory() || stat.isSymbolicLink()) return newest;
    const stack = [target];
    while (stack.length) {
      const current = stack.pop();
      let names;
      try { names = this.#fs.readdirSync(current); } catch { return Infinity; }
      for (const name of names) {
        if ((seen += 1) > WALK_LIMIT) return Infinity;
        const full = path.join(current, name);
        const inner = this.#lstat(full);
        if (!inner) return Infinity;
        newest = Math.max(newest, inner.mtimeMs);
        if (inner.isDirectory() && !inner.isSymbolicLink()) stack.push(full);
      }
    }
    return newest;
  }

  #worktrees(main) {
    const listed = this.#git(main, ['worktree', 'list', '--porcelain']);
    if (!listed.ok) return null;
    return listed.out.split(/\r?\n\r?\n/).map(block => {
      const entry = { path: null, branch: null, locked: false, prunable: false };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) entry.path = path.resolve(line.slice(9));
        else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true;
        else if (line === 'prunable' || line.startsWith('prunable ')) entry.prunable = true;
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
    // A scrap inside a worktree or a clone looks ignored and untracked from the main checkout, yet
    // it can be that checkout's uncommitted work. Only a whole checkout is ever judged.
    for (let dir = path.dirname(target); within(placed.root.dir, dir, { strict: true }); dir = path.dirname(dir)) {
      if (this.#holdsGit(dir)) return { ...item, reason: 'it is inside a Git checkout; Toolkit removes a whole clean worktree, never part of one' };
      if (this.#repository(dir)) return { ...item, reason: 'it is inside a Git repository; Toolkit never deletes part of one' };
    }
    // The scratch root itself must not be a checkout or a repository, and a repository above it
    // (a home folder kept in Git) must ignore the scrap and track nothing in it.
    if (this.#holdsGit(placed.root.dir) || this.#repository(placed.root.dir)) return { ...item, reason: 'its scratch root is itself a Git checkout or repository; Toolkit never deletes part of one' };
    if (placed.root.kind !== 'repo') {
      let above = false;
      const stop = placed.root.base || path.dirname(placed.root.dir);
      for (let dir = path.dirname(placed.root.dir); within(stop, dir); dir = path.dirname(dir)) {
        if (this.#holdsGit(dir) || this.#repository(dir)) above = true;
        if (dir === path.dirname(dir)) break;
      }
      const top = this.#git(path.dirname(target), ['rev-parse', '--show-toplevel']);
      const owner = top.ok && top.out.trim() ? path.resolve(top.out.trim()) : null;
      if (above && !owner) return { ...item, reason: 'a Git repository above its scratch root could not be read, so it may be that repository\'s work' };
      if (owner) {
        const tracked = this.#git(owner, ['ls-files', '--', target]);
        if (!tracked.ok || tracked.out.trim()) return { ...item, reason: 'a Git repository above its scratch root tracks files in it' };
        if (!this.#git(owner, ['check-ignore', '-q', '--', target]).ok) return { ...item, reason: 'a Git repository above its scratch root does not ignore it, so it may be real work' };
      }
    }
    // Git's own list of this repository's worktrees also counts, so a worktree whose pointer file
    // is missing (Git calls it prunable) still keeps the work inside it.
    let registered = null;
    if (main) {
      if (!worktrees) return { ...item, reason: 'the list of worktrees could not be read, so it may be part of one' };
      const forms = [target, placed.real];
      const same = (a, b) => within(a, b) && within(b, a);
      for (const entry of worktrees) {
        const places = [entry.path, this.#real(entry.path)].filter(Boolean);
        if (places.some(place => same(place, main) || same(place, this.#real(main) || main))) continue;
        if (places.some(place => forms.some(form => same(place, form)))) { registered = entry; continue; }
        if (places.some(place => forms.some(form => within(place, form)))) return { ...item, reason: 'it is inside a registered worktree; Toolkit removes a whole clean worktree, never part of one' };
        if (places.some(place => forms.some(form => within(form, place)))) return { ...item, reason: 'it holds a registered worktree, which may carry work that exists nowhere else' };
      }
    }
    if (placed.root.kind === 'repo') {
      const tracked = this.#git(main, ['ls-files', '--', target]);
      if (!tracked.ok || tracked.out.trim()) return { ...item, reason: 'Git tracks files in it' };
      if (!this.#git(main, ['check-ignore', '-q', '--', target]).ok) return { ...item, reason: 'Git does not ignore it, so it may be real work' };
    }
    const gitName = stat.isDirectory() ? this.#gitName(target) : null;
    const pointer = gitName ? this.#lstat(path.join(target, gitName)) : null;
    if (registered && !(pointer && pointer.isFile())) return { ...item, kind: 'worktree', reason: 'it is a registered worktree whose Git pointer file is missing, so its state cannot be read' };
    if (pointer) {
      item.kind = 'worktree';
      const known = pointer.isFile() && registered;
      if (!known) return { ...item, reason: 'it is a Git checkout that is not a registered worktree of this repository' };
      if (known.locked) return { ...item, reason: 'the worktree is locked' };
      const status = this.#git(target, [...STATUS, '--ignored']);
      if (!status.ok) return { ...item, reason: 'its state could not be read' };
      // An edit to a file marked assume-unchanged or skip-worktree never shows in the state.
      const flags = this.#git(target, ['ls-files', '-v']);
      if (!flags.ok) return { ...item, reason: 'its state could not be read' };
      if (flags.out.split(/\r?\n/).some(line => /^[a-zS] /.test(line))) return { ...item, reason: 'it has files Git was told not to check (assume-unchanged or skip-worktree), so an edit could be hidden' };
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
    if (!main) return { ok: false, reason: 'this folder is not inside a repository, so no evidence store could be read back' };
    if (!store) return { ok: false, reason: 'this repository binds no evidence store, so nothing could be read back' };
    if (!storePath) return { ok: false, reason: 'this repository has an evidence store and no --store <folder> was given' };
    const dir = path.resolve(storePath);
    if (githubSlug(this.#git(dir, ['remote', 'get-url', 'origin']).out) !== store.repository.toLowerCase()) return { ok: false, reason: 'that folder is not a checkout of the bound evidence store' };
    const branch = typeof store.branch === 'string' && BRANCH.test(store.branch) ? store.branch : 'main';
    if (!this.#git(dir, ['fetch', '--quiet', 'origin', branch], { timeout: 120000 }).ok) return { ok: false, reason: 'the evidence store could not be fetched' };
    const status = this.#git(dir, [...STATUS]);
    if (!status.ok || status.out.trim()) return { ok: false, reason: 'the evidence store checkout has changes that are not committed' };
    if (!this.#git(dir, ['merge-base', '--is-ancestor', 'HEAD', `refs/remotes/origin/${branch}`]).ok) return { ok: false, reason: 'the evidence store checkout has commits that are not on the remote' };
    return { ok: true, note: 'evidence store read back' };
  }

  plan({ repoRoot = null, paths = [], stale = false, branches = [] } = {}) {
    const main = this.mainCheckout(repoRoot);
    const here = repoRoot ? this.mainCheckout(null) : null;
    if (repoRoot && here && this.#real(here) !== this.#real(main || '')) throw new CleanupError('--repo-root names a different repository from the one this session is in.', 'run cleanup from inside that repository, or drop --repo-root.');
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
    if (result.read_back && !result.read_back.ok) lines.push(`Stopped: nothing was deleted, because ${result.read_back.reason}. Next: run cleanup inside the governed repository with --store <its evidence store folder>, after that store is committed and pushed; otherwise ask the owner.`);
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
  let result;
  try { result = applied ? cleaner.apply(options) : cleaner.plan(options); }
  catch (error) { if (!(error instanceof CleanupError)) throw error; err(`${error.message}\n`); return error.exitCode; }
  out(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${describe(result, applied).join('\n')}\n`);
  return applied && (result.failed.length || (result.read_back && !result.read_back.ok)) ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ ScratchCleaner, CleanupError, within, parseArgs, main, STALE_DAYS, TEMP_NAME, STATUS, GIT_REDIRECTS });
