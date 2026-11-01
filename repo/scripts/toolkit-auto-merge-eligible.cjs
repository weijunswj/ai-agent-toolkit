#!/usr/bin/env node
'use strict';

// Task auto-merge scope: whether a pull request may merge on the owner's standing answer
// (`task_prs.auto_merge: after-gates` in the merged programme binding), or changes the merge rules
// themselves and waits for the owner's typed merge whatever that answer says. It reads only the
// pull request's commits through git, so the controller runs it on the merge head before a merge
// and the merge hold (toolkit-merge-hold.cjs) runs it on this computer before letting a merge with
// no typed approval through. It loads only Node's own modules.
//
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--json]
//
// Exit 0: auto-merge may go ahead once the gate conditions hold. Exit 1: waits for the owner's
// typed merge, with each reason. Exit 2: the commits could not be read (also waits for the owner).
//
// The merge-authority list, each for the failure it prevents: a pull request that loosens the
// rules for whether and how merges happen would otherwise merge itself on those looser rules.
//   - the programme binding, its schema and its reader: they hold the owner's answer;
//   - the merge hold, its helpers and this check: they enforce it on this computer;
//   - the controller, global and gate rules, and the Approvals section of the Projects controller
//     skill: they say when a controller may merge;
//   - CI workflows: they decide what "every required check is green" means;
//   - a major version bump: a breaking release would go out unseen.
// Everything else (hooks, setup, agent instructions, the rest of governance) merges after the
// gates: its review tier and owner testing already hold the merge until they pass.
// A change that only moves version stamps (a managed block's toolkit=<version>, a "Version:
// <date>.<n>" line, a "version" or BRIDGE_VERSION value), as the release bump at merge time does,
// does not count. The rest of the gate conditions (review, CI, testing, one merge at a time, no
// open FAIL) are the controller's to check; see the gate rules' task auto-merge section.

const { spawnSync } = require('node:child_process');

// Any repository.
const GENERAL = Object.freeze([
  [/^\.github\/toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/ai-agent-toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/workflows\//, 'a CI workflow'],
]);

// The Toolkit repository's own merge rules (applied when the diff's repository is the Toolkit: it
// has the global rules source).
const TOOLKIT = Object.freeze([
  [/^repo\/contracts\/agent-rules\/(?:global|gate)-rules\.md$/, 'the agent rules on merging'],
  [/^repo\/CONTROLLER\.md$/, 'the controller rules'],
  [/^repo\/contracts\/programme-state\//, 'the programme binding schema'],
  [/^skills\/github-program-reconciler\/scripts\/programme-state\.cjs$/, 'the programme binding reader'],
  [/^repo\/scripts\/toolkit-merge-hold\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-shell-call\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-governance-gate\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-governance-state\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-auto-merge-eligible\.cjs$/, 'this merge-scope check'],
]);

// Files where only one section is on the list: [pattern, heading, why]. The file counts only when
// the text from that heading to the next heading of the same level changes.
const SECTIONS = Object.freeze([
  [/^repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md$/, '## Approvals', 'the Projects controller skill\'s Approvals section'],
]);

const TOOLKIT_MARKER = 'repo/contracts/agent-rules/global-rules.md';
const VERSION_FILES = Object.freeze(['repo/contracts/toolkit-local-bridge/version.json', 'package.json']);
const SEMVER = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/;

// Version stamps the release bump moves, blanked so a bump-only change compares equal.
function withoutStamps(text) {
  return String(text)
    .replace(/(\stoolkit=)\d+\.\d+\.\d+(?=\s)/g, '$1*')
    .replace(/^(Version: )\d{4}-\d{2}-\d{2}\.\d+$/gm, '$1*')
    .replace(/^(\s*"version":\s*")\d+\.\d+\.\d+(",?)$/gm, '$1*$2')
    .replace(/^(const BRIDGE_VERSION = ')\d+\.\d+\.\d+(';)$/gm, '$1*$2');
}

// The [pattern, why] rules for the Toolkit repository or any other.
function rulesFor(toolkit) { return toolkit ? [...GENERAL, ...TOOLKIT] : GENERAL; }
function sectionsFor(toolkit) { return toolkit ? SECTIONS : []; }

// The text of one section (its heading line to the next heading of the same or a higher level), or
// null when the file has no such heading.
function sectionOf(text, heading) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trimEnd() === heading);
  if (start < 0) return null;
  const level = /^#+/.exec(heading)[0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#+\s/.test(lines[end]) && /^#+/.exec(lines[end])[0].length <= level)) end += 1;
  return lines.slice(start, end).join('\n');
}

// The verdict for a pull request: { eligible, reasons: [{ path, why }] }. `files` are the changed
// paths (forward slashes); `toolkit` applies the Toolkit's own list; `stampOnly` lists changed paths
// whose only change is version stamps; `sectionChanged` lists changed paths whose listed section
// changed (or that were added or deleted); `versions` maps a version file to { before, after }.
function eligibility({ files, toolkit = false, stampOnly = [], sectionChanged = [], versions = {} }) {
  const rules = rulesFor(toolkit);
  const sections = sectionsFor(toolkit);
  const reasons = [];
  for (const file of files) {
    if (stampOnly.includes(file)) continue;
    const hit = rules.find(([pattern]) => pattern.test(file));
    if (hit) { reasons.push({ path: file, why: hit[1] }); continue; }
    const section = sections.find(([pattern]) => pattern.test(file));
    if (section && sectionChanged.includes(file)) reasons.push({ path: file, why: section[2] });
  }
  for (const [file, { before, after }] of Object.entries(versions)) {
    const from = SEMVER.exec(String(before || ''));
    const to = SEMVER.exec(String(after || ''));
    if (from && to && Number(to[1]) > Number(from[1])) reasons.push({ path: file, why: `a major version bump (${before} to ${after})` });
  }
  return { eligible: reasons.length === 0, reasons };
}

function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : null;
}

function versionAt(cwd, commit, file) {
  const text = git(cwd, ['show', `${commit}:${file}`]);
  if (text === null) return null;
  try { return JSON.parse(text).version || null; } catch { return null; }
}

// The verdict for the pull request from `base` to `head` in the repository at `cwd`, or null when
// git cannot read it.
function eligibilityOf(cwd, base, head) {
  const SHA = /^[0-9a-f]{7,64}$/i;
  if (!SHA.test(String(base)) || !SHA.test(String(head))) return null;
  const listed = git(cwd, ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`]);
  if (listed === null) return null;
  const files = listed.split('\0').filter(Boolean);
  // At either end, so a pull request that deletes the marker still gets the list.
  const toolkit = [base, head].some(commit => git(cwd, ['cat-file', '-e', `${commit}:${TOOLKIT_MARKER}`]) !== null);
  const versions = {};
  for (const file of VERSION_FILES) if (files.includes(file)) versions[file] = { before: versionAt(cwd, base, file), after: versionAt(cwd, head, file) };
  // Compared from the merge base, as the diff is; a file added or deleted is never stamp-only, and
  // its listed section always counts as changed.
  const from = (git(cwd, ['merge-base', base, head]) || '').trim();
  const based = /^[0-9a-f]{40,64}$/.test(from);
  const ends = file => (based ? [git(cwd, ['show', `${from}:${file}`]), git(cwd, ['show', `${head}:${file}`])] : [null, null]);
  const stampOnly = files.filter(file => rulesFor(toolkit).some(([pattern]) => pattern.test(file))).filter(file => {
    const [before, after] = ends(file);
    return before !== null && after !== null && withoutStamps(before) === withoutStamps(after);
  });
  const sectionChanged = [];
  for (const file of files) {
    const section = sectionsFor(toolkit).find(([pattern]) => pattern.test(file));
    if (!section) continue;
    const [before, after] = ends(file);
    if (before === null || after === null) { sectionChanged.push(file); continue; }
    const was = sectionOf(before, section[1]);
    const now = sectionOf(after, section[1]);
    if (was === null || now === null || withoutStamps(was) !== withoutStamps(now)) sectionChanged.push(file);
  }
  return eligibility({ files, toolkit, stampOnly, sectionChanged, versions });
}

// The commit a ref names in the repository at `cwd` (a ref such as refs/remotes/origin/main), or
// null when git cannot resolve it.
function commitOf(cwd, ref) {
  if (!/^[\w./-]+$/.test(String(ref)) || String(ref).startsWith('-')) return null;
  const sha = (git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || '').trim();
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const json = argv.includes('--json');
  const base = value('--base');
  const head = value('--head');
  if (!base || !head) { stderr.write('Usage: node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--json]\n'); return 2; }
  const verdict = eligibilityOf(cwd, base, head);
  if (!verdict) { stderr.write('The pull request\'s changes could not be read from git, so its merge scope is unknown. It waits for the owner\'s typed merge.\n'); return 2; }
  if (json) stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  else if (verdict.eligible) stdout.write('Auto-merge: yes. Nothing here changes the merge rules, so it merges once the gate conditions hold.\n');
  else stdout.write(`Waits for the owner's typed merge: this pull request changes the merge rules.\n${verdict.reasons.map(entry => `- ${entry.path}: ${entry.why}`).join('\n')}\n`);
  return verdict.eligible ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ GENERAL, SECTIONS, TOOLKIT, commitOf, eligibility, eligibilityOf, main, sectionOf, withoutStamps });
