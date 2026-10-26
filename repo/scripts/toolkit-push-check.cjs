'use strict';

// Checks what a `git push` or a new pull request (`gh pr create`) would send, before it leaves the
// computer, so an agent hears about a problem in the same turn instead of from CI later:
//   - a credential on an added line (the shared formats in skills/secure-ci-cd/scripts/secret-patterns.cjs:
//     fixed prefixes and exact lengths only, placeholders skipped, `secret-scan: allow <reason>` for a
//     reviewed exception). Only the file, line and kind are named, never any part of the value;
//   - plain-text findings in the changed files, in a repository that runs the plain-text check
//     (.github/plain-text.json, or Toolkit's own settings in the Toolkit source).
// The changes are those between HEAD and the branch it tracks, else origin's default branch; for a
// pull request, the base branch named by --base, else origin's default branch. A folder that is not a
// repository, or has neither branch, is not checked. Only the current branch (HEAD) is read, so
// `git push origin other-branch` is checked as the current branch.
//
// It fails open: when git cannot run, the checks take longer than 3 seconds in all, or a file or
// setting cannot be read, the command runs and one note is returned for stderr. A broken check must
// never stop every push; CI and GitHub push protection are the checks nothing gets around.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUDGET_MS = 3000;
const MAX_LISTED = 10;
const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const SKIPPED = 'Toolkit did not check this push for credentials and plain-text findings';

class CheckSkipped extends Error {}

function runGit(folder, args, deadline, spawn) {
  const left = deadline - Date.now();
  if (left <= 0) throw new CheckSkipped('it took longer than 3 seconds');
  const result = spawn('git', ['--no-optional-locks', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args], { cwd: folder, encoding: 'utf8', windowsHide: true, timeout: left, maxBuffer: MAX_DIFF_BYTES });
  if (result.error?.code === 'ETIMEDOUT' || (result.signal && result.status === null)) throw new CheckSkipped('it took longer than 3 seconds');
  if (result.error) throw new CheckSkipped(`git could not run (${result.error.code || 'error'})`);
  return result;
}

// The commit the outgoing changes are measured from, or '' when there is none to compare with.
function baseCommit(folder, pullRequestBase, deadline, spawn) {
  const verify = (ref) => {
    const result = runGit(folder, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], deadline, spawn);
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const candidates = pullRequestBase === undefined ? ['@{upstream}'] : pullRequestBase ? [`refs/remotes/origin/${pullRequestBase}`] : [];
  for (const ref of [...candidates, 'refs/remotes/origin/HEAD']) {
    const commit = verify(ref);
    if (commit) return commit;
  }
  return '';
}

// A path as git prints it in a diff header, with or without C-style quotes.
function diffPath(text) {
  if (!text.startsWith('"')) return text;
  try { return JSON.parse(text); } catch { return text.slice(1, -1); }
}

// Added lines per file from a `git diff -U0` patch: Map<file, [{ line, text }]>. Hunk sizes are
// followed, so an added line that itself starts with "+++" is never read as a file header.
function addedLines(patch) {
  const files = new Map();
  let file = null; let line = 0; let oldLeft = 0; let newLeft = 0;
  for (const raw of patch.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith('+')) { if (file) files.get(file).push({ line, text: text.slice(1) }); line += 1; newLeft -= 1; }
      else if (text.startsWith('-')) oldLeft -= 1;
      else if (text.startsWith(' ')) { line += 1; oldLeft -= 1; newLeft -= 1; }
      continue;
    }
    if (text.startsWith('+++ ')) {
      const name = diffPath(text.slice(4));
      file = name === '/dev/null' ? null : name.replace(/^b\//, '');
      if (file && !files.has(file)) files.set(file, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      line = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return files;
}

function secretFindings(changed, patterns) {
  const findings = [];
  for (const [file, lines] of changed) {
    for (const finding of patterns.scanLines(lines)) findings.push(`${file}:${finding.line}: ${finding.label}`);
  }
  return findings;
}

// The plain-text settings this repository runs with, or null when it does not run the check.
function plainTextSettings(top, portable) {
  const own = path.join(top, '.github', 'plain-text.json');
  const toolkit = path.join(top, 'repo', 'contracts', 'plain-references', 'config.json');
  let file = '';
  if (fs.existsSync(own)) file = own;
  else if (fs.existsSync(toolkit) && fs.existsSync(path.join(top, 'repo', 'scripts', 'check-plain-references.cjs'))) file = toolkit;
  if (!file) return null;
  const config = portable.readConfigFile(file);
  return config.off_reason ? null : config;
}

function plainTextFindings(top, files, portable) {
  const config = plainTextSettings(top, portable);
  if (!config) return [];
  const present = files.filter((rel) => fs.existsSync(path.join(top, rel)));
  return portable.check(top, config, { files: present }).failures.map((finding) => portable.describeFailure(finding, config));
}

function refusalText(secrets, plain, action) {
  const items = [...secrets, ...plain];
  const listed = items.slice(0, MAX_LISTED).map((item) => `  ${item}`);
  if (items.length > MAX_LISTED) listed.push(`  ...and ${items.length - MAX_LISTED} more.`);
  const advice = [];
  if (secrets.length) advice.push('Credentials: take each one out of the commits being sent, and treat it as exposed if it was real. For a reviewed false positive, add `secret-scan: allow <reason>` on that line.');
  if (plain.length) advice.push('Plain-text items: rewrite them in plain English.');
  return [`Toolkit checked what this ${action} would send and found ${items.length} item(s) to fix first:`, ...listed, ...advice, `Then ${action === 'push' ? 'push' : 'open the pull request'} again.`].join('\n');
}

// { refusal, note } for one outgoing change set: target is { folder, pullRequestBase? }, where
// pullRequestBase is undefined for a push and a branch name or '' for a pull request.
function checkOutgoing(target, {
  spawn = spawnSync,
  patterns = () => require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs'),
  portable = () => require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs'),
  budgetMs = BUDGET_MS
} = {}) {
  const deadline = Date.now() + budgetMs;
  try {
    const top = runGit(target.folder, ['rev-parse', '--show-toplevel'], deadline, spawn);
    if (top.status !== 0) return {};
    const root = path.resolve(top.stdout.trim());
    const base = baseCommit(root, target.pullRequestBase, deadline, spawn);
    if (!base) return {};
    const range = `${base}...HEAD`;
    const patch = runGit(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-filter=d', '--src-prefix=a/', '--dst-prefix=b/', range, '--'], deadline, spawn);
    if (patch.status !== 0) throw new CheckSkipped('git could not read the changes');
    // Every changed text file has a +++ header; binary files and mode-only changes add no text.
    const changed = addedLines(patch.stdout);
    if (!changed.size) return {};
    const secrets = secretFindings(changed, patterns());
    const plain = plainTextFindings(root, [...changed.keys()], portable());
    if (Date.now() > deadline && !secrets.length && !plain.length) throw new CheckSkipped('it took longer than 3 seconds');
    if (!secrets.length && !plain.length) return {};
    return { refusal: refusalText(secrets, plain, target.pullRequestBase === undefined ? 'push' : 'pull request') };
  } catch (error) {
    const why = error instanceof CheckSkipped ? error.message : `the check failed (${error?.code || error?.name || 'error'})`;
    return { note: `${SKIPPED}: ${why}. CI still checks it.` };
  }
}

module.exports = Object.freeze({ BUDGET_MS, MAX_LISTED, addedLines, checkOutgoing });
