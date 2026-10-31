#!/usr/bin/env node
'use strict';

// Task auto-merge eligibility: whether a pull request may merge on the owner's standing answer
// (`task_prs.auto_merge: after-gates` in the merged programme binding), or is on the always-manual
// list and waits for the owner whatever that answer says. It reads only the pull request's commits
// through git, so it runs the same in CI (the `auto-merge-eligible` check, which runs the default
// branch's copy of this file, .github/workflows/auto-merge-eligible.yml) and for the controller
// before a merge. It loads only Node's own modules, so that copy runs on its own.
//
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--owner-merge] [--binding-at <commit>] [--json]
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --label-decision   (the workflow's label step)
//
// --binding-at <commit> (the workflow passes its default-branch checkout) reads the programme
// binding at that commit first. While it does not say `task_prs.auto_merge: after-gates`, nothing
// merges without the owner, so the check passes and only lists what would be always manual; a
// binding that cannot be read keeps the full check. Without the flag (the controller's own run
// before a merge) the check is always the full one.
//
// Exit 0: eligible, or always manual and the owner allowed it (--owner-merge, which the workflow
// passes when the label step allows it: the OWNER_LABEL label, added by the repository owner and
// tied to this head). Exit 1: always
// manual, with each reason.
// Exit 2: the commits could not be read.
//
// Always manual, each for the failure it prevents:
//   - the merge rules and their records (the programme binding, the merge hold, governance, the
//     global rules, gate rules, controller and Projects skill text): an agent pull request that
//     widens auto-merge would otherwise merge itself;
//   - hooks: every hooks.json, every script it runs and every module those load, at either end of
//     the pull request, and setup that writes host hook config: a hook change would otherwise reach
//     every computer before the owner saw its real-host smoke result;
//   - CI workflows: a pull request could weaken the checks that are meant to stop it;
//   - agent instruction files (AGENTS.md, CLAUDE.md and their shims), which rule-refresh pull
//     requests change: the owner decided those always wait for them;
//   - a major version bump: a breaking release would go out unseen.
// A change that only moves version stamps (a managed block's toolkit=<version>, a "Version:
// <date>.<n>" line, a "version" or BRIDGE_VERSION value), as the release bump at merge time does,
// does not count. The rest of the gate conditions (review, CI, testing, one merge at a time, no
// open FAIL) are the controller's to check; see the gate rules' task auto-merge section.

const { spawnSync } = require('node:child_process');

// The label the owner adds in GitHub to let an always-manual pull request merge. Agents never add it.
const OWNER_LABEL = 'toolkit-owner-merge';

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

// The Toolkit repository's own merge rules, governance and hook setup (applied when the diff's
// repository is the Toolkit: it has the global rules source).
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
  [/^repo\/scripts\/setup-(?:codex|claude)-toolkit-plugin\.cjs$/, 'setup that writes host hook config'],
]);
const HOOK_MODULE = 'a module the hooks load';
const TOOLKIT_MARKER = 'repo/contracts/agent-rules/global-rules.md';
const VERSION_FILES = Object.freeze(['repo/contracts/toolkit-local-bridge/version.json', 'package.json']);
const SEMVER = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/;
const SCRIPT = /\.(?:cjs|js|mjs|ps1|sh)$/;

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

// Every repository file the hooks load: the scripts each hooks.json names, then every file those
// reach through a relative require, a path built from a quoted file name, or a path a launcher
// names. `paths` lists the commit's files and `read(path)` returns one's text or null. It leans
// towards listing too much: a file it lists only waits for the owner.
function hookModules(paths, read) {
  const known = new Set(paths);
  const dirOf = file => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const resolve = (from, relative) => {
    const parts = (dirOf(from) ? dirOf(from).split('/') : []);
    for (const part of relative.split('/')) {
      if (part === '..') parts.pop(); else if (part !== '.' && part !== '') parts.push(part);
    }
    return parts.join('/');
  };
  const found = new Set();
  const queue = [];
  const add = file => { if (known.has(file) && !found.has(file)) { found.add(file); queue.push(file); } };
  for (const file of paths.filter(name => /(?:^|\/)hooks\.json$/.test(name))) {
    for (const match of String(read(file) || '').matchAll(/(?:repo|skills)\/[\w./-]+?\.(?:cjs|js|mjs|ps1|sh)\b/g)) add(match[0]);
  }
  while (queue.length > 0) {
    const file = queue.shift();
    const text = String(read(file) || '');
    for (const match of text.matchAll(/(?:repo|skills)[\\/][\w.\\/-]+?\.(?:cjs|js|mjs|ps1|sh)\b/g)) add(match[0].replace(/\\/g, '/'));
    for (const match of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const target = resolve(file, match[1]);
      add(target);
      add(`${target}.cjs`);
      add(`${target}.js`);
    }
    // A file name in quotes, as in path.join(__dirname, 'x.cjs') or path.join(ROOT, 'repo', 'scripts', 'x.cjs').
    for (const match of text.matchAll(/['"]([\w.-]+\.(?:cjs|js|mjs|ps1|sh))['"]/g)) {
      add(dirOf(file) ? `${dirOf(file)}/${match[1]}` : match[1]);
      add(`repo/scripts/${match[1]}`);
    }
  }
  return found;
}

// The verdict for a pull request: { eligible, reasons: [{ path, why }] }. `files` are the changed
// paths (forward slashes); `toolkit` applies the Toolkit's own list; `hooks` holds the files the
// hooks load at either end; `stampOnly` lists changed paths whose only change is version stamps;
// `versions` maps a version file to { before, after }.
function eligibility({ files, toolkit = false, hooks = new Set(), stampOnly = [], versions = {} }) {
  const rules = rulesFor(toolkit);
  const reasons = [];
  for (const file of files) {
    if (stampOnly.includes(file)) continue;
    const hit = rules.find(([pattern]) => pattern.test(file));
    if (hit) reasons.push({ path: file, why: hit[1] });
    else if (hooks.has(file)) reasons.push({ path: file, why: HOOK_MODULE });
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

// The files the hooks load at one commit, or null when git cannot list them.
function hookModulesAt(cwd, commit) {
  const listed = git(cwd, ['ls-tree', '-r', '--name-only', '-z', commit]);
  if (listed === null) return null;
  const paths = listed.split('\0').filter(Boolean);
  return hookModules(paths, file => (SCRIPT.test(file) || /hooks\.json$/.test(file) ? git(cwd, ['show', `${commit}:${file}`]) : null));
}

// The verdict for the pull request from `base` to `head` in the repository at `cwd`, or null when
// git cannot read it.
function eligibilityOf(cwd, base, head) {
  const SHA = /^[0-9a-f]{7,64}$/i;
  if (!SHA.test(String(base)) || !SHA.test(String(head))) return null;
  const listed = git(cwd, ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`]);
  if (listed === null) return null;
  const files = listed.split('\0').filter(Boolean);
  // At either end, so a pull request that deletes the marker, or drops a module from the hooks,
  // still gets the list.
  const toolkit = [base, head].some(commit => git(cwd, ['cat-file', '-e', `${commit}:${TOOLKIT_MARKER}`]) !== null);
  const hooks = new Set();
  for (const commit of [base, head]) {
    const found = hookModulesAt(cwd, commit);
    if (found === null) return null;
    for (const file of found) hooks.add(file);
  }
  const versions = {};
  for (const file of VERSION_FILES) if (files.includes(file)) versions[file] = { before: versionAt(cwd, base, file), after: versionAt(cwd, head, file) };
  // Compared from the merge base, as the diff is; a file added or deleted is never stamp-only.
  const from = (git(cwd, ['merge-base', base, head]) || '').trim();
  const onList = files.filter(file => hooks.has(file) || rulesFor(toolkit).some(([pattern]) => pattern.test(file)));
  const stampOnly = !/^[0-9a-f]{40,64}$/.test(from) ? [] : onList.filter(file => {
    const before = git(cwd, ['show', `${from}:${file}`]);
    const after = git(cwd, ['show', `${head}:${file}`]);
    return before !== null && after !== null && withoutStamps(before) === withoutStamps(after);
  });
  return eligibility({ files, toolkit, hooks, stampOnly, versions });
}

const BINDING_FILES = Object.freeze(['.github/toolkit-programme.json', '.github/ai-agent-toolkit-programme.json']);

// Whether the programme binding at `commit` turns task auto-merge on: 'on', 'off', or 'unknown'
// when it cannot be read (which keeps the full check). No binding file at all is 'off'.
function taskAutoMergeAt(cwd, commit) {
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit))) return 'unknown';
  if (git(cwd, ['cat-file', '-e', `${commit}^{commit}`]) === null) return 'unknown';
  for (const file of BINDING_FILES) {
    const text = git(cwd, ['show', `${commit}:${file}`]);
    if (text === null) continue;
    let binding;
    try { binding = JSON.parse(text); } catch { return 'unknown'; }
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return 'unknown';
    const taskPrs = binding.task_prs;
    if (taskPrs === undefined) return 'off';
    if (!taskPrs || typeof taskPrs !== 'object' || Array.isArray(taskPrs)) return 'unknown';
    if (taskPrs.auto_merge === 'after-gates') return 'on';
    return taskPrs.auto_merge === undefined || taskPrs.auto_merge === 'off' ? 'off' : 'unknown';
  }
  return 'off';
}

// The commit status that ties the owner's label to the head it was added on. Only the workflow's own
// token writes it, so it reads as made by github-actions[bot]; an agent working through the owner's
// login would show as the owner.
const OWNER_STATUS_CREATOR = 'github-actions[bot]';

// What the workflow does with the owner's label for one event, whatever runs were cancelled before:
// { owner_merge, record, remove }. `labels` are the pull request's labels, `added` the label a
// labeled event added, `sender` ({ login, type }) who sent that event, `owner` the repository
// owner's login, `statuses` the head commit's statuses ({ context, state, creator }).
//   - the labeled event that adds it records the status on the head it was added on, and passes,
//     only when the repository owner's own user account added it; a bot, an app or anyone else
//     adding it has the label removed and fails (an agent working through the owner's login still
//     reads as the owner: the accepted gap the merge hold covers). In a repository an organisation
//     owns, no user is the owner, so the label never counts there: it fails closed;
//   - taking the label off, or a refused label, sets that status to failure on the head;
//   - any other run passes only while the newest such status on the head, from the workflow, is a
//     success;
//   - a push, or a label with no status on this head (a run that recorded it was cancelled, or the
//     label was added before a push the removal missed), removes the label and fails.
function addedByOwner(sender, owner) {
  return Boolean(sender && owner && typeof sender.login === 'string' && sender.login !== ''
    && sender.login.toLowerCase() === String(owner).toLowerCase() && sender.type === 'User');
}

function labelDecision({ action, labels = [], added = null, sender = null, owner = null, statuses = [] }) {
  // Taking the label off withdraws the owner's OK for this head: the run records a failure status,
  // which is then the newest, so a label added back later (and its refusal cancelled) cannot reuse it.
  if (action === 'unlabeled' && added === OWNER_LABEL && !labels.includes(OWNER_LABEL)) return { owner_merge: false, record: false, remove: false, withdraw: true };
  if (!labels.includes(OWNER_LABEL)) return { owner_merge: false, record: false, remove: false };
  if (action === 'labeled' && added === OWNER_LABEL) {
    return addedByOwner(sender, owner)
      ? { owner_merge: true, record: true, remove: false }
      : { owner_merge: false, record: false, remove: true, not_owner: true, withdraw: true };
  }
  // GitHub lists a commit's statuses newest first; only the newest one from the workflow counts.
  const newest = statuses.find(entry => entry && entry.context === OWNER_LABEL && entry.creator === OWNER_STATUS_CREATOR);
  const recorded = Boolean(newest && newest.state === 'success');
  if (action === 'synchronize' || !recorded) return { owner_merge: false, record: false, remove: true };
  return { owner_merge: true, record: false, remove: false };
}

// The workflow's label step: reads ACTION, LABELS, ADDED_LABEL, SENDER, SENDER_TYPE, OWNER and
// STATUSES (JSON, newest first) from the environment and prints `owner_merge=0|1 record=0|1
// remove=0|1`, plus `not_owner=1` when someone other than the owner added the label and
// `withdraw=1` when the head's toolkit-owner-merge status is to be set to failure. Anything unreadable gives no
// owner merge and removes nothing.
function labelDecisionMain(environment, stdout) {
  let labels = [];
  let statuses = [];
  try { labels = JSON.parse(environment.LABELS || '[]'); } catch { labels = []; }
  try { statuses = JSON.parse(environment.STATUSES || '[]'); } catch { statuses = null; }
  const decision = Array.isArray(labels) && Array.isArray(statuses)
    ? labelDecision({
      action: environment.ACTION,
      labels,
      added: environment.ADDED_LABEL || null,
      sender: { login: environment.SENDER || '', type: environment.SENDER_TYPE || '' },
      owner: environment.OWNER || null,
      statuses,
    })
    : { owner_merge: false, record: false, remove: false };
  const notOwner = decision.not_owner ? ' not_owner=1' : '';
  const withdraw = decision.withdraw ? ' withdraw=1' : '';
  stdout.write(`owner_merge=${Number(decision.owner_merge)} record=${Number(decision.record)} remove=${Number(decision.remove)}${notOwner}${withdraw}\n`);
  return 0;
}

function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, environment = process.env } = {}) {
  if (argv[0] === '--label-decision') return labelDecisionMain(environment, stdout);
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const json = argv.includes('--json');
  const ownerMerge = argv.includes('--owner-merge');
  const base = value('--base');
  const head = value('--head');
  if (!base || !head) { stderr.write('Usage: node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> [--owner-merge] [--binding-at <commit>] [--json]\n'); return 2; }
  const bindingAt = value('--binding-at');
  if (argv.includes('--binding-at') && !bindingAt) { stderr.write('Usage: --binding-at needs a commit.\n'); return 2; }
  const autoMerge = bindingAt ? taskAutoMergeAt(cwd, bindingAt) : 'on';
  const verdict = eligibilityOf(cwd, base, head);
  if (!verdict) { stderr.write('The pull request\'s changes could not be read from git, so its auto-merge eligibility is unknown. It waits for the owner.\n'); return 2; }
  const allowed = !verdict.eligible && ownerMerge;
  const off = autoMerge === 'off' && !verdict.eligible && !allowed;
  if (json) stdout.write(`${JSON.stringify({ ...verdict, owner_merge: allowed, ...(bindingAt ? { task_auto_merge: autoMerge } : {}) }, null, 2)}\n`);
  else if (off) {
    const reasons = verdict.reasons.map(entry => `- ${entry.path}: ${entry.why}`).join('\n');
    stdout.write(`Task auto-merge is off in this repository's merged programme binding, so every pull request merges by hand and this check passes. Were it on, this one would be always manual:\n${reasons}\n`);
  } else if (verdict.eligible) stdout.write('Eligible for task auto-merge: nothing here is on the always-manual list.\n');
  else {
    const reasons = verdict.reasons.map(entry => `- ${entry.path}: ${entry.why}`).join('\n');
    stdout.write(allowed
      ? `Always manual, and the owner allowed this merge with the ${OWNER_LABEL} label.\n${reasons}\n`
      : `Always manual: this pull request merges once the owner adds the ${OWNER_LABEL} label in GitHub.\n${reasons}\n`);
  }
  return verdict.eligible || allowed || off ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ GENERAL, OWNER_LABEL, OWNER_STATUS_CREATOR, TOOLKIT, eligibility, eligibilityOf, hookModules, hookModulesAt, labelDecision, main, taskAutoMergeAt, withoutStamps });
