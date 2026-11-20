'use strict';

// The one notice a session gets when its own session start moved the managed Toolkit checkout:
// both versions, what changed (the changelog's bullet titles between them), a pointer to the global
// rules when their source changed, and a new-session line when hooks or the skill list changed.
// The bridge prints it once, from the run that moved the checkout, so a session start that finds
// nothing new prints nothing. It stays well inside the host's 10,000-character hook limit.

const os = require('node:os');
const path = require('node:path');
const { harnessFile, SOURCE: GLOBAL_RULES_SOURCE } = require('./toolkit-global-rules.cjs');

const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const CHANGELOG = 'repo/docs/CHANGELOG.md';
const MAX_CHANGES = 15;
const MAX_LINE = 160;
const HOOK_FILES = Object.freeze({ 'claude-plugin': '.claude-plugin/hooks/hooks.json', 'codex-plugin': '.codex-plugin/hooks/hooks.json', repo: '.claude-plugin/hooks/hooks.json' });
const SKILL_FILE = /^skills\/[^/]+\/SKILL\.md$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function compare(left, right) {
  const a = SEMVER.exec(left), b = SEMVER.exec(right);
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(a[index]) - Number(b[index]);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

// The bullet titles (the bold lead of each bullet, else its start) of every changelog entry newer
// than `from` and not newer than `to`, newest first.
function changesBetween(changelog, from, to) {
  if (!SEMVER.test(from) || !SEMVER.test(to)) return [];
  const titles = [];
  let inRange = false;
  for (const line of String(changelog || '').split(/\r?\n/)) {
    const heading = /^## (\d+\.\d+\.\d+)\b/.exec(line);
    if (heading) { inRange = compare(heading[1], from) > 0 && compare(heading[1], to) <= 0; continue; }
    if (!inRange || !line.startsWith('- ')) continue;
    const bold = /^- \*\*(.+?):?\*\*/.exec(line);
    const text = (bold ? bold[1] : line.slice(2)).replace(/:$/, '').trim();
    titles.push(text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 3)}...` : text);
  }
  return titles;
}

// A file under the home folder as ~/..., so the notice names no private path.
function homeRelative(file, environment) {
  const home = (process.platform === 'win32' ? environment.USERPROFILE || environment.HOME : environment.HOME || environment.USERPROFILE) || os.homedir();
  const relative = path.relative(home, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `~/${relative.replace(/\\/g, '/')}` : file.replace(/\\/g, '/');
}

// `git(args)` returns { ok, stdout } for a git command in the checkout. `hooksRunCheckout` is true
// when this session's hooks run from the checkout itself (Claude Code running Toolkit in place), so
// the next hook call already runs the new scripts. Returns '' when the run moved nothing.
function updateNotice({ git, fromCommit, toCommit, changedFiles = [], syncSource = 'claude-plugin', hooksRunCheckout = false, environment = process.env }) {
  if (!fromCommit || !toCommit || fromCommit === toCommit) return '';
  const show = (commit, file) => { const result = git(['show', `${commit}:${file}`]); return result.ok ? result.stdout : ''; };
  const versionAt = (commit) => { try { return JSON.parse(show(commit, VERSION_FILE)).version || ''; } catch { return ''; } };
  const from = versionAt(fromCommit);
  const to = versionAt(toCommit);
  // The same version on both commits (a change not yet released) is told apart by commit.
  const byCommit = !from || !to || from === to;
  const label = (version, commit) => (byCommit ? `${version ? `${version} at ` : ''}${commit.slice(0, 7)}` : version);
  const lines = [`Toolkit update notice: this session start updated Toolkit on this computer from ${label(from, fromCommit)} to ${label(to, toCommit)}.`];
  if (hooksRunCheckout) lines.push("Toolkit's hook scripts in this session run the new code from the next tool call.");
  const titles = changesBetween(show(toCommit, CHANGELOG), from, to);
  if (titles.length) {
    lines.push(`What changed (${CHANGELOG}):`);
    for (const title of titles.slice(0, MAX_CHANGES)) lines.push(`- ${title}`);
    if (titles.length > MAX_CHANGES) lines.push(`- and ${titles.length - MAX_CHANGES} more in ${CHANGELOG}`);
  }
  const changed = new Set(changedFiles.map((file) => String(file).replace(/\\/g, '/')));
  if (changed.has(GLOBAL_RULES_SOURCE)) {
    const harness = syncSource === 'codex-plugin' ? 'codex' : 'claude-code';
    lines.push(`Toolkit's global rules changed: before your next step, read the GLOBAL-RULES block in ${homeRelative(harnessFile(harness, environment), environment)} again; it replaces the copy this session loaded.`);
  }
  const skillsAddedOrRemoved = () => {
    const result = git(['diff', '--name-only', '--diff-filter=AD', fromCommit, toCommit, '--', 'skills']);
    return result.ok && result.stdout.split(/\r?\n/).some((file) => SKILL_FILE.test(file.trim()));
  };
  if (changed.has(HOOK_FILES[syncSource] || HOOK_FILES.repo) || skillsAddedOrRemoved()) {
    lines.push('New or changed hooks and newly added skills take effect only in a new session; this session keeps the ones it started with.');
  }
  return lines.join('\n');
}

module.exports = Object.freeze({ MAX_CHANGES, changesBetween, updateNotice });
