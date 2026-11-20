'use strict';

// Brings the session's own checkout up to date with its origin's default branch at session start,
// so a chat or an owner test never runs on a local default branch that is behind origin.
//
// It adds no network read of its own. The governance session start (toolkit-governance-gate.cjs
// startSession) already fetched origin's default branch into its remote-tracking ref this start
// (toolkit-governance-binding.cjs, no prompts, hooks off, bounded, remote identity checked); this
// module only fast-forwards the local branch to the commit that read fetched. It moves the checkout
// only when all of these hold, and otherwise changes nothing:
//   - the read ran this start (refreshed); a cached or failed read never moves anything;
//   - the root is not Toolkit's own (the managed checkout the bridge updates, anything under
//     ~/.ai-agent-toolkit, or the running plugin root);
//   - HEAD is the default branch, its upstream is origin/<default>, and it is strictly behind;
//   - no merge, rebase, cherry-pick, revert or bisect is in progress, and `git status` is empty
//     (untracked files count; ignored ones do not);
//   - the repository has no post-merge, post-checkout or reference-transaction hook, and no file the
//     move changes has a filter attribute (Git LFS), so the move runs no repository code.
// The move is `git merge --ff-only` with an empty hooks folder, run from git's PATH location with no
// prompts and no timeout (stopping git half way through a checkout is worse than a slow start).
//
// What the session sees: one line when the checkout moved, or when it is on the default branch,
// behind, and could not move. Every other case (another branch, detached, ahead, up to date, no
// fresh read, Toolkit's own checkout) prints nothing. It never throws. It reads no governance state,
// so it behaves the same whether governance is on, off or undecided.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { defaultRunGit } = require('./toolkit-governance-binding.cjs');
// ~/.ai-agent-toolkit, as the bridge and the update marker name it.
const { defaultControlRoot } = require('./toolkit-update-marker.cjs');

const READ_TIMEOUT_MS = 5000;
// A move can name many files; their list is read whole.
const LIST_BUFFER = 64 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;
// The git commands this module may run (the first word after any -c pairs or global flags). A test
// pins it: never reset, checkout, switch, stash, rebase, pull, push, update-ref, branch, clean or force.
const ALLOWED_VERBS = Object.freeze(['symbolic-ref', 'rev-parse', 'merge-base', 'rev-list', 'config', 'status', 'diff', 'check-attr', 'merge']);
const MOVE_HOOKS = Object.freeze(['post-merge', 'post-checkout', 'reference-transaction']);
const IN_PROGRESS = Object.freeze(['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']);
// Variables that would point git at another repository, worktree or index than the session's own.
const REDIRECTING_ENVIRONMENT = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']);
const INSTRUCTION_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md']);

const REASONS = Object.freeze({
  upstream: branch => `its upstream is not origin/${branch}`,
  operation: () => 'a merge, rebase, cherry-pick, revert or bisect is in progress',
  dirty: () => 'uncommitted changes',
  diverged: () => 'it has local commits that are not on origin',
  hooks: () => 'the repository has merge or checkout hooks, which Toolkit does not run',
  filters: () => 'files the move changes use a filter such as Git LFS',
  unreadable: () => 'git could not list the files the move changes',
  busy: () => 'git was busy or the move failed',
});

const short = sha => sha.slice(0, 7);
const commits = count => `${count} commit${count === 1 ? '' : 's'}`;

function behindLine(branch, behind, reason) {
  return `Toolkit: local ${branch} is ${commits(behind)} behind origin/${branch} and was not moved: ${REASONS[reason](branch)}.`;
}

function movedLine(branch, from, to, behind, instructions) {
  const line = `Toolkit: brought local ${branch} up to date with origin/${branch} (${short(from)} to ${short(to)}, ${commits(behind)}).`;
  return instructions ? `${line} AGENTS.md or CLAUDE.md changed; read them again before acting.` : line;
}

function samePath(a, b) {
  try {
    const left = fs.realpathSync.native(a), right = fs.realpathSync.native(b);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  } catch { return false; }
}

function inside(parent, child) {
  try {
    const relative = path.relative(fs.realpathSync.native(parent), fs.realpathSync.native(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch { return false; }
}

// Whether root is Toolkit's own checkout: anything under ~/.ai-agent-toolkit, the managed checkout
// the bridge records (state.json repo_path, which the bridge's update owns) or the running plugin.
function toolkitOwn(root, { controlRoot, pluginRoot }) {
  if (inside(controlRoot, root) || samePath(root, pluginRoot)) return true;
  let recorded = '';
  try { recorded = JSON.parse(fs.readFileSync(path.join(controlRoot, 'current', 'state.json'), 'utf8').replace(/^﻿/, '')).repo_path; } catch { recorded = ''; }
  return typeof recorded === 'string' && recorded !== '' && samePath(root, recorded);
}

function gitEnvironment(environment) {
  const clean = { ...environment };
  for (const name of REDIRECTING_ENVIRONMENT) delete clean[name];
  return clean;
}

// The repository's merge and checkout hooks, read where git looks for them (core.hooksPath or the
// hooks folder of the common git directory). Any file there counts, executable or not.
function moveHooks(root, hooksPath) {
  const folder = path.resolve(root, hooksPath);
  return MOVE_HOOKS.some(name => { try { return fs.statSync(path.join(folder, name)).isFile(); } catch { return false; } });
}

// Paths from a NUL-separated list.
function nulList(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

// Whether any of `files` has a filter attribute set, judged by the attributes `source` carries (or
// the working tree's when source is null). null when git could not say.
function filtered(git, files, source) {
  if (files.length === 0) return false;
  const run = git(['check-attr', '-z', '--stdin', ...(source ? ['--source', source] : []), 'filter'], { input: `${files.join('\0')}\0`, maxBuffer: LIST_BUFFER });
  if (run.status !== 0) return null;
  const fields = run.stdout.toString('utf8').split('\0');
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (!['unspecified', 'unset'].includes(fields[index + 2])) return true;
  }
  return false;
}

// Whether the move changed an instruction file a session reads at start: AGENTS.md or CLAUDE.md in
// any folder, or a file the root CLAUDE.md imports (`@path`).
function instructionsChanged(root, files) {
  if (files.some(file => INSTRUCTION_FILES.includes(file.split('/').pop()))) return true;
  let text = '';
  try { text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { return false; }
  const imported = new Set();
  for (const match of text.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
    const resolved = path.relative(root, path.resolve(root, match[1]));
    if (resolved && !resolved.startsWith('..') && !path.isAbsolute(resolved)) imported.add(resolved.split(path.sep).join('/'));
  }
  return files.some(file => imported.has(file));
}

// One line, or null. `read` is the session start's refresh result (refreshMergedBinding): its
// root, default branch and the commit just fetched. Never throws.
function catchUp(read, { runGit = defaultRunGit, environment = process.env, controlRoot = null, pluginRoot = path.resolve(__dirname, '..', '..') } = {}) {
  try {
    if (!read || read.refreshed !== true) return null;
    const { root, default_branch: branch, commit: target } = read;
    if (typeof root !== 'string' || !path.isAbsolute(root) || !BRANCH.test(String(branch)) || branch.startsWith('-') || !SHA.test(String(target))) return null;
    if (toolkitOwn(root, { controlRoot: controlRoot || defaultControlRoot(environment), pluginRoot })) return null;
    const env = gitEnvironment(environment);
    // Reads stop after READ_TIMEOUT_MS; the move passes `unbounded` and is never stopped.
    const git = (args, { unbounded = false, input, maxBuffer } = {}) => {
      try { return runGit(args, { cwd: root, timeout: unbounded ? undefined : READ_TIMEOUT_MS, input, maxBuffer, environment: env }); } catch { return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    };
    const text = run => run.stdout.toString('utf8').trim();

    // Only the default branch itself, checked out here, is ever moved.
    const head = git(['symbolic-ref', '--quiet', 'HEAD']);
    if (head.status !== 0 || text(head) !== `refs/heads/${branch}`) return null;
    const current = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    const from = current.status === 0 ? text(current) : '';
    if (!SHA.test(from) || from === target) return null;
    // Ahead of origin, or a commit git cannot place: nothing to catch up.
    const ahead = git(['merge-base', '--is-ancestor', target, 'HEAD']);
    if (ahead.status !== 1) return null;
    const count = git(['rev-list', '--count', `HEAD..${target}`]);
    const behind = count.status === 0 ? Number(text(count)) : NaN;
    if (!(Number.isInteger(behind) && behind > 0)) return null;

    // From here the checkout is on the default branch and behind: a skip says why.
    const remote = git(['config', '--get', `branch.${branch}.remote`]);
    const merge = git(['config', '--get', `branch.${branch}.merge`]);
    if (text(remote) !== 'origin' || text(merge) !== `refs/heads/${branch}`) return behindLine(branch, behind, 'upstream');
    const gitDir = git(['rev-parse', '--absolute-git-dir']);
    if (gitDir.status !== 0) return behindLine(branch, behind, 'busy');
    if (IN_PROGRESS.some(name => fs.existsSync(path.join(text(gitDir), name)))) return behindLine(branch, behind, 'operation');
    const status = git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);
    if (status.status !== 0) return behindLine(branch, behind, 'busy');
    if (text(status) !== '') return behindLine(branch, behind, 'dirty');
    if (git(['merge-base', '--is-ancestor', 'HEAD', target]).status !== 0) return behindLine(branch, behind, 'diverged');
    const hooksPath = git(['rev-parse', '--git-path', 'hooks']);
    if (hooksPath.status !== 0) return behindLine(branch, behind, 'busy');
    if (moveHooks(root, text(hooksPath))) return behindLine(branch, behind, 'hooks');
    const changed = git(['diff', '--name-only', '-z', '--no-renames', 'HEAD', target], { maxBuffer: LIST_BUFFER });
    if (changed.status !== 0) return behindLine(branch, behind, 'unreadable');
    const files = nulList(changed.stdout);
    const before = filtered(git, files, null), after = filtered(git, files, target);
    if (before === null || after === null) return behindLine(branch, behind, 'unreadable');
    if (before || after) return behindLine(branch, behind, 'filters');

    // The move: fast-forward only, with an empty hooks folder, never stopped by Toolkit.
    let hooksDir = null;
    try {
      hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-catchup-hooks-'));
      const moved = git(['-c', `core.hooksPath=${hooksDir}`, 'merge', '--ff-only', '--no-stat', '--quiet', target], { unbounded: true });
      if (moved.status !== 0) return behindLine(branch, behind, 'busy');
    } finally { if (hooksDir) { try { fs.rmSync(hooksDir, { recursive: true, force: true }); } catch { /* temp folder */ } } }
    const now = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    if (now.status !== 0 || text(now) !== target) return behindLine(branch, behind, 'busy');
    return movedLine(branch, from, target, behind, instructionsChanged(root, files));
  } catch { return null; }
}

module.exports = Object.freeze({ ALLOWED_VERBS, MOVE_HOOKS, IN_PROGRESS, catchUp });
