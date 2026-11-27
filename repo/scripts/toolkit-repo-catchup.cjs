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
//     (untracked files count; ignored ones do not), apart from untracked files that the move adds
//     with exactly the same bytes (leftovers of a setup whose pull request now holds them, such as an
//     older governance turn-on wrote into the checkout). Those are removed just before the move, which
//     writes them back as tracked files, and are put back as they were if the move fails. Any other
//     change, or an untracked file that differs or that the move does not add, keeps the checkout;
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
const ALLOWED_VERBS = Object.freeze(['symbolic-ref', 'rev-parse', 'merge-base', 'rev-list', 'config', 'status', 'diff', 'check-attr', 'cat-file', 'merge']);
// The most untracked leftovers, and the largest one, the catch-up compares with the incoming commit.
// More or larger keeps the checkout where it is, as any other uncommitted change does.
const LEFTOVER_LIMIT = 256;
const LEFTOVER_BYTES = 4 * 1024 * 1024;
// Regular file modes in a commit; a link or submodule the move adds is never matched to a file.
const FILE_MODES = Object.freeze(['100644', '100755']);
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

function movedLine(branch, from, to, behind, instructions, cleared = []) {
  const files = cleared.length ? ` Untracked copies of ${cleared.length === 1 ? 'a file' : `${cleared.length} files`} it adds, identical to the merged ones, were replaced by the tracked files: ${cleared.map(entry => entry.file).join(', ')}.` : '';
  const line = `Toolkit: brought local ${branch} up to date with origin/${branch} (${short(from)} to ${short(to)}, ${commits(behind)}).${files}`;
  return instructions ? `${line} AGENTS.md or CLAUDE.md changed; read them again before acting.` : line;
}

// The untracked files in `status` (porcelain -z with every untracked file listed) when each one is a
// regular file the move adds with exactly the same bytes: [{ file, bytes, mode }]. null when anything
// else is changed, or any untracked file differs, is not added by the move, or cannot be read.
function identicalLeftovers(git, root, target) {
  const status = git(['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none'], { maxBuffer: LIST_BUFFER });
  if (status.status !== 0) return null;
  const entries = nulList(status.stdout);
  if (entries.length === 0 || entries.length > LEFTOVER_LIMIT || entries.some(entry => !entry.startsWith('?? '))) return null;
  const files = entries.map(entry => entry.slice(3));
  // What the move adds: ":<old mode> <new mode> <old id> <new id> <status>" then the path.
  const raw = git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', 'HEAD', target], { maxBuffer: LIST_BUFFER });
  if (raw.status !== 0) return null;
  const fields = raw.stdout.toString('utf8').split('\0');
  const added = new Map();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, mode, , id, change] = fields[index].replace(/^:/, '').split(' ');
    if (change === 'A' && FILE_MODES.includes(mode) && SHA.test(id)) added.set(fields[index + 1], id);
  }
  const found = [];
  for (const file of files) {
    const id = added.get(file);
    if (!id) return null;
    let stat;
    try { stat = fs.lstatSync(path.join(root, ...file.split('/'))); } catch { return null; }
    if (!stat.isFile() || stat.size > LEFTOVER_BYTES) return null;
    found.push({ file, id, mode: stat.mode, size: stat.size });
  }
  // The incoming blobs, read whole in one call: "<id> blob <size>\n<bytes>\n" each.
  const blobs = git(['cat-file', '--batch'], { input: `${found.map(entry => entry.id).join('\n')}\n`, maxBuffer: LIST_BUFFER });
  if (blobs.status !== 0) return null;
  const out = blobs.stdout;
  let offset = 0;
  for (const entry of found) {
    const end = out.indexOf(0x0a, offset);
    if (end < 0) return null;
    const [id, type, size] = out.subarray(offset, end).toString('utf8').split(' ');
    if (id !== entry.id || type !== 'blob' || Number(size) !== entry.size) return null;
    let bytes;
    try { bytes = fs.readFileSync(path.join(root, ...entry.file.split('/'))); } catch { return null; }
    if (!bytes.equals(out.subarray(end + 1, end + 1 + entry.size))) return null;
    entry.bytes = bytes;
    offset = end + 1 + entry.size + 1;
  }
  return found.map(({ file, bytes, mode }) => ({ file, bytes, mode }));
}

// Puts removed leftovers back exactly as they were (a move that failed after they were removed).
function restore(root, cleared) {
  for (const entry of cleared) {
    try {
      const file = path.join(root, ...entry.file.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, entry.bytes, { mode: entry.mode });
    } catch { /* reported by the not-moved line; the merged commit holds the same bytes */ }
  }
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
    const leftovers = text(status) === '' ? [] : identicalLeftovers(git, root, target);
    if (!leftovers) return behindLine(branch, behind, 'dirty');
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

    // The move: fast-forward only, with an empty hooks folder, never stopped by Toolkit. Identical
    // leftovers are removed first (git refuses to overwrite untracked files) and put back if it fails.
    let hooksDir = null;
    const cleared = [];
    try {
      hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-catchup-hooks-'));
      for (const entry of leftovers) {
        const file = path.join(root, ...entry.file.split('/'));
        // Read again just before it goes, so a file changed since the comparison is never removed.
        let same = false;
        try { same = fs.lstatSync(file).isFile() && fs.readFileSync(file).equals(entry.bytes); } catch { same = false; }
        if (!same) { restore(root, cleared); return behindLine(branch, behind, 'dirty'); }
        try { fs.rmSync(file); cleared.push(entry); }
        catch { restore(root, cleared); return behindLine(branch, behind, 'busy'); }
      }
      const moved = git(['-c', `core.hooksPath=${hooksDir}`, 'merge', '--ff-only', '--no-stat', '--quiet', target], { unbounded: true });
      if (moved.status !== 0) { restore(root, cleared); return behindLine(branch, behind, 'busy'); }
    } finally { if (hooksDir) { try { fs.rmSync(hooksDir, { recursive: true, force: true }); } catch { /* temp folder */ } } }
    const now = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    if (now.status !== 0 || text(now) !== target) return behindLine(branch, behind, 'busy');
    return movedLine(branch, from, target, behind, instructionsChanged(root, files), cleared);
  } catch { return null; }
}

module.exports = Object.freeze({ ALLOWED_VERBS, MOVE_HOOKS, IN_PROGRESS, catchUp });
