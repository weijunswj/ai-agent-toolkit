#!/usr/bin/env node
'use strict';

// Lists the worktrees and local branches a checkout still holds after their work merged, so the
// owner can see what is left and decide what to remove. Read only: it runs git queries, reads no
// file contents itself and deletes nothing. Paths are shown relative to the primary checkout.
//
//   node repo/scripts/workspace-residue-report.cjs [--repo <checkout>] [--base <ref>] [--budget-ms <n>]
//     [--min-age-hours <n>] [--worktree <path>] [--json]
//
// --repo defaults to the current folder, --base to origin/main (fetch first for a current answer).
// --budget-ms caps the worktree checks (default 60000, at least 1000); worktrees past the cap are listed
// as not checked. --min-age-hours keeps a worktree made more recently than that out of the ready list
// (default 0). --worktree checks only that one listed worktree and prints the commands to remove it when
// it is ready. A worktree or branch is "ready to remove" when it is clean, unlocked, holds no ignored files
// (git worktree remove deletes those too) and its commit is already in the base; everything else says why
// it needs a look first. The default branch is never offered. Worktrees a host made (Claude Code's
// .claude/worktrees, Codex's worktrees folder) are listed but left to the host's own clean-up.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const USAGE = 'Usage: node repo/scripts/workspace-residue-report.cjs [--repo <checkout>] [--base <ref>] [--budget-ms <n>] [--min-age-hours <n>] [--worktree <path>] [--json]';
const DEFAULT_BUDGET_MS = 60000;
const MIN_BUDGET_MS = 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOT_CHECKED = 'not checked (time budget reached)';

class UsageError extends Error {}

// A whole number for a value option, or a usage error naming the option and the range it needs.
function wholeNumber(arg, value, min, need) {
  if (!/^\d+$/.test(value) || Number(value) < min) throw new UsageError(`${arg} needs a whole number ${need}.`);
  return Number(value);
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), base: 'origin/main', json: false, budgetMs: DEFAULT_BUDGET_MS, minAgeHours: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--repo', '--base', '--budget-ms', '--min-age-hours', '--worktree'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
      index += 1;
      if (arg === '--budget-ms') options.budgetMs = wholeNumber(arg, value, MIN_BUDGET_MS, 'of milliseconds, at least 1000');
      else if (arg === '--min-age-hours') options.minAgeHours = wholeNumber(arg, value, 0, 'of hours, 0 or more');
      else options[arg.slice(2)] = value;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`Unknown argument ${arg}.`);
  }
  return options;
}

// git with optional locks off, so a status query never rewrites the index of a worktree it looks at.
// A timeout in milliseconds stops the call once the time budget has run out.
function git(cwd, args, timeoutMs) {
  const result = childProcess.spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
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

// Paths compare as the file system does: case-insensitively on Windows.
function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// A shown path inside a command: double quotes when it has a space.
function quoted(shownPath) {
  return shownPath.includes(' ') ? `"${shownPath}"` : shownPath;
}

function inBase(repo, commit, base, timeoutMs) {
  return git(repo, ['merge-base', '--is-ancestor', commit, base], timeoutMs).ok;
}

// The time budget for the worktree checks. It starts with the report, and each git call gets what is
// left of it, never less than a second.
function budgetClock(budgetMs, nowMs) {
  const startMs = nowMs();
  const elapsed = () => nowMs() - startMs;
  return {
    reached: () => elapsed() >= budgetMs,
    timeoutMs: () => Math.max(MIN_BUDGET_MS, budgetMs - elapsed()),
  };
}

// Whole hours since the worktree's .git file was written, or null when the file cannot be read.
function ageHours(worktreePath, nowMs) {
  try {
    const written = fs.statSync(path.join(worktreePath, '.git')).mtimeMs;
    return Math.max(0, Math.floor((nowMs - written) / HOUR_MS));
  } catch {
    return null;
  }
}

// Checks one extra worktree. Once the time budget is reached it is listed as not checked, with no git call.
function inspectWorktree(item, ctx) {
  const place = placeOf(item.path, ctx.primary);
  const exists = fs.existsSync(item.path);
  const known = { ...item, path: shown(ctx.primary, item.path), place, exists, age_hours: ageHours(item.path, ctx.nowMs()) };
  if (ctx.clock.reached()) {
    return { ...known, checked: false, changes: null, ignored: null, merged: null, ready: false, reasons: [NOT_CHECKED] };
  }
  const host = place === 'Claude Code' || place === 'Codex';
  // Names of changed and ignored files are counted, never read.
  const status = exists ? git(item.path, ['status', '--porcelain', '--untracked-files=normal', '--ignored=matching'], ctx.clock.timeoutMs()) : null;
  const lines = status && status.ok ? status.stdout.split('\n').filter(Boolean) : null;
  const changes = lines ? lines.filter((line) => !line.startsWith('!! ')).length : null;
  const ignored = lines ? lines.length - changes : null;
  const merged = item.head ? inBase(ctx.repo, item.head, ctx.base, ctx.clock.timeoutMs()) : false;
  const age = known.age_hours;
  const reasons = [];
  if (!exists) reasons.push('folder is gone (git worktree prune clears the record)');
  if (item.locked) reasons.push('locked');
  if (exists && changes === null) reasons.push('status unreadable');
  if (changes) reasons.push(`${changes} uncommitted change(s)`);
  if (ignored) reasons.push(`${ignored} ignored item(s) that git worktree remove deletes`);
  if (!merged) reasons.push(`commit not in ${ctx.base}`);
  if (ctx.minAgeHours > 0 && age === null) reasons.push('age unreadable');
  else if (age !== null && age < ctx.minAgeHours) reasons.push(`made less than ${ctx.minAgeHours} hour${ctx.minAgeHours === 1 ? '' : 's'} ago`);
  if (host) reasons.push('host-made, left to the host');
  return { ...known, checked: true, changes, ignored, merged, ready: reasons.length === 0, reasons };
}

// The one extra worktree that a --worktree path names. The primary checkout and any unlisted path are refused.
function pickWorktree(listed, primary, worktree) {
  const wanted = path.resolve(worktree);
  if (samePath(primary, wanted)) throw new UsageError('The primary checkout is not an extra worktree.');
  const found = listed.slice(1).find((item) => samePath(item.path, wanted));
  if (!found) throw new UsageError(`${shown(primary, wanted)} is not a worktree of this checkout.`);
  return found;
}

// Local branches other than the checked-out one, each with its ready or look-first reasons.
function branchReports(repo, base, listed) {
  const inUse = new Set(listed.map((item) => item.branch).filter(Boolean));
  const current = git(repo, ['branch', '--show-current']).stdout.trim();
  const names = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).stdout.split('\n').filter(Boolean);
  const defaults = defaultBranches(repo, base);
  return names.filter((name) => name !== current).map((name) => {
    const merged = inBase(repo, `refs/heads/${name}`, base);
    const reasons = [];
    if (defaults.has(name)) reasons.push('default branch, keep');
    if (inUse.has(name)) reasons.push('checked out in a worktree');
    if (!merged) reasons.push(`not merged into ${base}`);
    return { name, merged, ready: reasons.length === 0, reasons };
  });
}

// The commands for a ready worktree. The branch is included only when it is merged, is not a default
// branch and no other worktree holds it. Never --force or -D.
function removeCommands(item, listed, repo, base) {
  if (!item.ready) return [];
  const commands = [`git worktree remove ${quoted(item.path)}`];
  const branch = item.branch;
  const holders = branch ? listed.filter((other) => other.branch === branch).length : 0;
  if (branch && holders === 1 && !defaultBranches(repo, base).has(branch) && inBase(repo, `refs/heads/${branch}`, base)) {
    commands.push(`git branch -d ${branch}`);
  }
  return commands;
}

// Builds the report for one checkout. Throws UsageError when the folder is not a checkout, the base is unknown
// or --worktree does not name an extra worktree of it. Options: budgetMs, minAgeHours, worktree (one path to
// check alone), onWorktree(item) (called as each worktree is decided) and nowMs (a clock, for tests).
function collect(repo, base, options = {}) {
  const { budgetMs = DEFAULT_BUDGET_MS, minAgeHours = 0, worktree, onWorktree = () => {}, nowMs = Date.now } = options;
  const clock = budgetClock(budgetMs, nowMs);
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new UsageError(`${repo} is not a git checkout.`);
  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) throw new UsageError(`The base ${base} is not known here. Fetch it first or pass --base.`);
  const listed = parseWorktrees(git(repo, ['worktree', 'list', '--porcelain']).stdout);
  const primary = path.resolve(listed.length ? listed[0].path : top.stdout.trim());
  const single = worktree !== undefined;
  const extras = single ? [pickWorktree(listed, primary, worktree)] : listed.slice(1);
  const ctx = { repo, base, primary, minAgeHours, nowMs, clock };
  const worktrees = [];
  for (const item of extras) {
    const record = inspectWorktree(item, ctx);
    worktrees.push(record);
    onWorktree(record);
  }
  const report = {
    schema: 'toolkit-workspace-residue/v1',
    repo: path.basename(primary),
    base,
    complete: worktrees.every((item) => item.checked),
    worktrees,
    branches: single ? [] : branchReports(repo, base, listed),
  };
  if (single) report.remove_commands = removeCommands(worktrees[0], listed, repo, base);
  return report;
}

function reasonText(item) {
  return item.reasons.length ? ` (${item.reasons.join('; ')})` : '';
}

// One line per worktree, written as soon as the worktree is decided.
function worktreeLine(item) {
  return `- ${item.ready ? 'ready to remove' : 'look first'}: ${item.path} [${item.branch || 'detached'}, ${item.place}]${reasonText(item)}`;
}

// The text after the worktree lines: the budget note, the branches and how to remove. main writes each
// worktree line as it is checked, so this does not repeat them.
function render(report) {
  const lines = [];
  const missed = report.worktrees.filter((item) => !item.checked).length;
  if (missed) lines.push('', `Stopped at the time budget: ${missed} worktree${missed === 1 ? '' : 's'} not checked; run again with a larger --budget-ms.`);
  lines.push('', `Local branches other than the current one: ${report.branches.length}`);
  for (const item of report.branches) lines.push(`- ${item.ready ? 'ready to remove' : 'look first'}: ${item.name}${reasonText(item)}`);
  lines.push('', 'To remove a ready worktree: git worktree remove <path>, then git worktree prune. A ready branch: git branch -d <name>. Never --force or -D.');
  return `${lines.join('\n')}\n`;
}

// Text for --worktree: the removal commands when the worktree is ready, else the reasons it is not.
function renderOne(report) {
  const [item] = report.worktrees;
  if (!item.ready) return `Not ready to remove: ${item.reasons.join('; ')}\n`;
  return `${report.remove_commands.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) { out.write(`${USAGE}\n`); return 0; }
    const repo = path.resolve(options.repo);
    const settings = { budgetMs: options.budgetMs, minAgeHours: options.minAgeHours, worktree: options.worktree };
    if (options.json) {
      out.write(`${JSON.stringify(collect(repo, options.base, settings), null, 2)}\n`);
    } else if (options.worktree !== undefined) {
      out.write(renderOne(collect(repo, options.base, settings)));
    } else {
      // The heading goes out with the first worktree line, so a folder that is refused prints nothing.
      let headed = false;
      const head = () => {
        if (headed) return;
        headed = true;
        out.write(`Workspace residue against ${options.base}. Nothing was changed.\n\nExtra worktrees:\n`);
      };
      const report = collect(repo, options.base, { ...settings, onWorktree: (item) => { head(); out.write(`${worktreeLine(item)}\n`); } });
      head();
      out.write(render(report));
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) { err.write(`${error.message}\n${USAGE}\n`); return 2; }
    throw error;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ collect, main, parseArgs, parseWorktrees, placeOf, render });
