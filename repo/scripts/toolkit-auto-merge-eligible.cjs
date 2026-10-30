#!/usr/bin/env node
'use strict';

// Task auto-merge eligibility: whether a pull request may merge on the owner's standing answer
// (`task_prs.auto_merge: after-gates` in the merged programme binding), or must wait for the owner
// to type merge whatever that answer says. It reads only the pull request's changed paths and the
// version it records, so it runs the same in CI (the `auto-merge-eligible` check, which runs the
// default branch's copy of this file, .github/workflows/auto-merge-eligible.yml) and for the
// controller before a merge. It loads only Node's own modules, so that copy runs on its own.
//
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--json]
//
// Exit 0: eligible. Exit 1: always manual, with each reason. Exit 2: the diff could not be read.
//
// Always manual, each for the failure it prevents:
//   - the merge rules and their records (the programme binding, the merge hold, governance, the
//     global rules, gate rules, controller and Projects skill text): an agent pull request that
//     widens auto-merge would otherwise merge itself;
//   - hooks and host hook settings: a broken hook would reach every computer before the owner saw
//     its smoke result;
//   - CI workflows: a pull request could weaken the checks that are meant to stop it;
//   - agent instruction files (AGENTS.md, CLAUDE.md and their shims), which rule-refresh pull
//     requests change: the owner decided those always wait for them;
//   - a major version bump: a breaking release would go out unseen.
// A change that only moves Toolkit version stamps (a managed block's toolkit=<version>, a
// "Version: <date>.<n>" line), as the release bump at merge time does, does not count.
// The rest of the gate conditions (review, CI, testing, one merge at a time, no open FAIL) are the
// controller's to check; see the gate rules' task auto-merge section.

const { spawnSync } = require('node:child_process');

// Any repository.
const GENERAL = Object.freeze([
  [/^\.github\/toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/ai-agent-toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/workflows\//, 'a CI workflow'],
  [/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/, 'agent instructions'],
  [/^\.github\/copilot-instructions\.md$/, 'agent instructions'],
  [/^\.cursor\/rules\//, 'agent instructions'],
  [/^\.agents\/rules\//, 'agent instructions'],
  [/(?:^|\/)hooks\.json$/, 'a hook'],
  [/(?:^|\/)hooks\//, 'a hook'],
  [/-hook\.(?:c?js|mjs|ps1|sh)$/, 'a hook'],
  [/^\.claude\/settings(?:\.local)?\.json$/, 'host hook settings'],
  [/^\.codex\//, 'host hook settings'],
]);

// The Toolkit repository's own merge rules, governance and setup (applied when the diff's repository
// is the Toolkit: it has the global rules source).
const TOOLKIT = Object.freeze([
  [/^repo\/contracts\/agent-rules\//, 'the agent rules'],
  [/^repo\/CONTROLLER\.md$/, 'the controller rules'],
  [/^repo\/contracts\/claude-projects\//, 'the Projects controller skill'],
  [/^repo\/contracts\/programme-state\//, 'the programme binding schema'],
  [/^skills\/github-program-reconciler\/scripts\/programme-state\.cjs$/, 'the programme binding reader'],
  [/^skills\/repository-agent-rules\//, 'agent instructions'],
  [/^repo\/scripts\/toolkit-merge-hold\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-auto-merge-eligible\.cjs$/, 'this eligibility check'],
  [/^repo\/scripts\/toolkit-shell-call\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-governance[\w.-]*\.cjs$/, 'governance'],
  [/^repo\/scripts\/toolkit-hook[\w.-]*\.cjs$/, 'a hook'],
]);
const TOOLKIT_MARKER = 'repo/contracts/agent-rules/global-rules.md';
const VERSION_FILES = Object.freeze(['repo/contracts/toolkit-local-bridge/version.json', 'package.json']);
const SEMVER = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/;

// Version stamps the release bump moves, blanked so a bump-only change compares equal.
function withoutStamps(text) {
  return String(text).replace(/(\stoolkit=)\d+\.\d+\.\d+(?=\s)/g, '$1*').replace(/^(Version: )\d{4}-\d{2}-\d{2}\.\d+$/gm, '$1*');
}

// The [pattern, why] rules for the Toolkit repository or any other.
function rulesFor(toolkit) { return toolkit ? [...GENERAL, ...TOOLKIT] : GENERAL; }

// The verdict for a pull request: { eligible, reasons: [{ path, why }] }. `files` are the changed
// paths (forward slashes); `toolkit` applies the Toolkit's own list; `stampOnly` lists changed
// paths whose only change is version stamps; `versions` maps a version file to { before, after }.
function eligibility({ files, toolkit = false, stampOnly = [], versions = {} }) {
  const rules = rulesFor(toolkit);
  const reasons = [];
  for (const file of files) {
    if (stampOnly.includes(file)) continue;
    const hit = rules.find(([pattern]) => pattern.test(file));
    if (hit) reasons.push({ path: file, why: hit[1] });
  }
  for (const [file, { before, after }] of Object.entries(versions)) {
    const from = SEMVER.exec(String(before || ''));
    const to = SEMVER.exec(String(after || ''));
    if (from && to && Number(to[1]) > Number(from[1])) reasons.push({ path: file, why: `a major version bump (${before} to ${after})` });
  }
  return { eligible: reasons.length === 0, reasons };
}

function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
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
  // At either end, so a pull request that deletes the marker still gets the Toolkit's list.
  const toolkit = [base, head].some(commit => git(cwd, ['cat-file', '-e', `${commit}:${TOOLKIT_MARKER}`]) !== null);
  const versions = {};
  for (const file of VERSION_FILES) if (files.includes(file)) versions[file] = { before: versionAt(cwd, base, file), after: versionAt(cwd, head, file) };
  // Compared from the merge base, as the diff is; a file added or deleted is never stamp-only.
  const from = (git(cwd, ['merge-base', base, head]) || '').trim();
  const onList = files.filter(file => rulesFor(toolkit).some(([pattern]) => pattern.test(file)));
  const stampOnly = !/^[0-9a-f]{40,64}$/.test(from) ? [] : onList.filter(file => {
    const before = git(cwd, ['show', `${from}:${file}`]);
    const after = git(cwd, ['show', `${head}:${file}`]);
    return before !== null && after !== null && withoutStamps(before) === withoutStamps(after);
  });
  return eligibility({ files, toolkit, stampOnly, versions });
}

function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const json = argv.includes('--json');
  const base = value('--base');
  const head = value('--head');
  if (!base || !head) { stderr.write('Usage: node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--json]\n'); return 2; }
  const verdict = eligibilityOf(cwd, base, head);
  if (!verdict) { stderr.write('The pull request\'s changes could not be read from git, so its auto-merge eligibility is unknown. It waits for the owner.\n'); return 2; }
  if (json) stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  else if (verdict.eligible) stdout.write('Eligible for task auto-merge: nothing here is on the always-manual list.\n');
  else stdout.write(`Always manual: the owner types merge for this pull request.\n${verdict.reasons.map(entry => `- ${entry.path}: ${entry.why}`).join('\n')}\n`);
  return verdict.eligible ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ GENERAL, TOOLKIT, eligibility, eligibilityOf, main, withoutStamps });
