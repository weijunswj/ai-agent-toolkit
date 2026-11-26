#!/usr/bin/env node
'use strict';

// Copies the Toolkit's cloud workflows into a governed repository, so its programme board refreshes
// on GitHub instead of on a computer.
//
// The copies are rendered from the Toolkit's own workflow files at the commit this checkout is on,
// read from git, never from the working tree (from an app plugin copy, which has no git, the managed
// Toolkit checkout the bridge keeps current). Each copy checks out Toolkit main into `.toolkit/`
// (public, no token), or the commit the repository's TOOLKIT_REF variable pins (the owner's kill
// switch: `gh variable set TOOLKIT_REF --repo <owner/name> --body <commit>`), and runs the scripts
// from there, while the binding and the working folder stay the governed repository's own. The render
// itself is toolkit-cloud-workflows-render.cjs; its header says what it changes. Each copy carries a
// managed header line naming the Toolkit commit it was rendered from, the copy's hash and its layout,
// so --check can tell a current copy from a stale or hand-edited one. Stale means the layout only: a
// copy is current while its body is what a refresh writes now, whichever commit rendered it. A copy
// from before layouts pins every Toolkit checkout to one commit and is always outdated. A copy from
// an older commit is also re-rendered at that commit, when this checkout has it and the render file is
// unchanged since, so an edit whose hash was recomputed still shows.
//
// --refresh-pr brings a governed repository's stale copies up to date through one pull request for
// the owner to merge (toolkit-cloud-workflows-refresh.cjs); nothing is written to the checkout.
//
// DEFAULT_CLOUD_WORKFLOWS is the one list of what a governed repository carries: turning governance on,
// the refresh pull request (a rerun and a takeover go through it) and the governance check all read it,
// so a later workflow joins everywhere by joining the list. Programme Sweep and its gate go to every
// governed repository whose default branch is main, and the personal data guard and dependency
// auto-merge, which are copied as they are (toolkit-cloud-workflows-copied.cjs), to every one. The test
// shards workflow and Shard Timings go only to a repository whose merged binding answers yes to parallel
// CI shards (ci_shards, asked by refresh governance) and that has a usable shard list
// (.github/toolkit-test-shards.json, see governed-test-shards.cjs). Anything left out is named with the
// reason. The test
// shards copy carries the list's shard ids in its matrix, so a change to the list's shards makes the
// copy outdated (a rules refresh rewrites it), never edited.
//
// Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check | --refresh-pr] [--json]
// Exit codes: 0 done (or no drift, or nothing for --refresh-pr to do), 1 drift found by --check,
// 2 not installed or no pull request made (the reason is printed).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TOOLKIT_REPOSITORY, TOOLKIT_PATH, TOOLKIT_REF, LAYOUT, MARKER, SHA, SHARD_ID, InstallError, normalise, withoutPins, bodyHash, render } = require('./toolkit-cloud-workflows-render.cjs');
const governedShards = require('./governed-test-shards.cjs');
const { COPIED_FILES, COPIED_SOURCES, clashNote, copiedRows } = require('./toolkit-cloud-workflows-copied.cjs');

const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const RENDER_FILE = 'repo/scripts/toolkit-cloud-workflows-render.cjs';
// The one list. `kind` says how the copy is made: 'rendered' (at a Toolkit commit, from `source`, with a
// managed marker) or 'copied' (as it is). `needs` names what a repository must have for it: 'main' (a
// default branch called main) or 'shards' (a yes and a usable shard list; the test shards copy then goes
// to the file the list's `workflow` names and is rendered from a Toolkit template that runs nowhere in
// the Toolkit itself). `consequence` is what a copy that drifted costs the repository, for the check.
const DEFAULT_CLOUD_WORKFLOWS = Object.freeze([
  { id: 'programme-sweep', kind: 'rendered', needs: 'main', file: '.github/workflows/toolkit-programme-sweep.yml', consequence: 'this repository\'s programme board gets no cloud sweep' },
  { id: 'programme-sweep-gate', kind: 'rendered', needs: 'main', file: '.github/workflows/toolkit-programme-sweep-gate.yml', consequence: 'this repository\'s programme board gets no cloud sweep' },
  { id: 'personal-data-guard', kind: 'copied', file: COPIED_FILES['personal-data-guard'][0], consequence: 'pull requests and pushes here are not checked for personal data and AI footers as the Toolkit wrote it' },
  { id: 'dependency-auto-merge', kind: 'copied', file: COPIED_FILES['dependency-auto-merge'][0], consequence: 'Dependabot pull requests here are not handled as the Toolkit wrote it' },
  { id: 'test-shards', kind: 'rendered', needs: 'shards', source: 'repo/contracts/ci/governed-test-shards.yml', file: `.github/workflows/${governedShards.DEFAULT_WORKFLOW}`, consequence: 'this repository\'s Toolkit test shards and their gate do not run as the Toolkit wrote them' },
  { id: 'shard-timings', kind: 'rendered', needs: 'shards', source: '.github/workflows/toolkit-shard-timings.yml', file: '.github/workflows/toolkit-shard-timings.yml', consequence: 'this repository\'s test shard timings are not refreshed as the Toolkit wrote them' },
].map(row => Object.freeze(row.kind === 'rendered' ? { source: row.file, ...row } : row)));
const RENDERED = DEFAULT_CLOUD_WORKFLOWS.filter(row => row.kind === 'rendered');
const SWEEPS = RENDERED.filter(row => row.needs === 'main');
const SHARD_WORKFLOWS = RENDERED.filter(row => row.needs === 'shards');
const GATE = RENDERED.find(row => row.id === 'programme-sweep-gate');
// Every path a default cloud workflow's files may have (the test shards copy at its default name).
const DEFAULT_FILES = Object.freeze(DEFAULT_CLOUD_WORKFLOWS.flatMap(row => (row.kind === 'copied' ? COPIED_FILES[row.id] : [row.file])));
const RESERVED = new Set(DEFAULT_CLOUD_WORKFLOWS.map(row => row.file.slice('.github/workflows/'.length)).filter(name => name !== governedShards.DEFAULT_WORKFLOW));
const CI_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const USAGE = 'Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check | --refresh-pr] [--json]';

const TOOLKIT_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)weijunswj\/ai-agent-toolkit(?:\.git)?\/?$/i;
// A Toolkit source checkout runs its own workflow files. This file has been there far longer than
// the installer, so older Toolkit branches are recognised too.
const isToolkitCheckout = dir => fs.existsSync(path.join(dir, 'repo', 'scripts', 'toolkit-governance-conformance.cjs'));

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, stdout: String(result.stdout || '') };
}

// Whether `dir` is a git checkout whose origin is the Toolkit repository (a fork never counts).
const isToolkitClone = dir => fs.existsSync(path.join(dir, '.git')) && TOOLKIT_REMOTE.test(git(dir, ['remote', 'get-url', 'origin']).stdout.trim());

// The Toolkit git checkout the copies are rendered from: this copy when it is one,
// otherwise the managed checkout the bridge keeps current (its recorded path, then the default
// place), because an app's plugin copy has no git. The first whose origin is the Toolkit repository
// wins; with none, this copy, which then fails with the reason.
function sourceRoot({ home = os.homedir(), self = TOOLKIT_ROOT } = {}) {
  const candidates = [self];
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), 'utf8')).repo_path;
    if (typeof saved === 'string' && saved) candidates.push(saved);
  } catch { /* no bridge state */ }
  candidates.push(path.join(home, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit'));
  for (const candidate of candidates) if (isToolkitClone(candidate)) return path.resolve(candidate);
  return self;
}

// The installer to render with for a source checkout: its own copy of this file, so the render logic
// always matches the commit the copies are pinned to (this file for this checkout).
// A source without its own installer file renders with this one.
function installerAt(source) {
  const file = source ? path.join(path.resolve(source), 'repo', 'scripts', 'toolkit-cloud-workflows.cjs') : null;
  return file && path.resolve(source) !== TOOLKIT_ROOT && fs.existsSync(file) ? require(file) : module.exports;
}

// The Toolkit commit to pin: this checkout's HEAD, which must already be on origin/main, so a
// governed repository's runner can fetch it from the public repository.
function toolkitHead(root = TOOLKIT_ROOT) {
  const head = git(root, ['rev-parse', 'HEAD']).stdout.trim();
  if (!SHA.test(head)) throw new InstallError('the Toolkit checkout has no readable commit.');
  return head;
}

function toolkitCommit(root = TOOLKIT_ROOT) {
  const head = toolkitHead(root);
  const remote = git(root, ['remote', 'get-url', 'origin']).stdout.trim();
  if (!TOOLKIT_REMOTE.test(remote)) throw new InstallError(`the Toolkit checkout's origin is not ${TOOLKIT_REPOSITORY}, so its commit could not be fetched from there.`);
  if (!git(root, ['merge-base', '--is-ancestor', head, 'refs/remotes/origin/main']).ok) {
    throw new InstallError(`Toolkit commit ${head.slice(0, 7)} is not on origin/main, so GitHub could not fetch it. Update the Toolkit checkout to main first.`);
  }
  return head;
}

// The text of several Toolkit files at one commit, read in one git process: the session start reads them
// in every governed repository. Returns file => text, which throws for a file that commit does not have.
function sourceTexts(files, commit, root) {
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: files.map(file => `${commit}:${file}\n`).join(''), windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024 });
  const texts = new Map();
  let at = 0;
  for (const file of result.error || result.status !== 0 ? [] : files) {
    const end = result.stdout.indexOf(10, at);
    const header = /^[0-9a-f]+ blob (\d+)$/.exec(result.stdout.subarray(at, end).toString('utf8'));
    at = end + 1;
    if (!header) continue;
    texts.set(file, normalise(result.stdout.subarray(at, at + Number(header[1])).toString('utf8')));
    at += Number(header[1]) + 1;
  }
  return file => {
    if (!texts.has(file)) throw new InstallError(`${file} is missing at Toolkit commit ${commit.slice(0, 7)}.`);
    return texts.get(file);
  };
}

// The name: line of the repository's CI workflow, for the gate's workflow_run trigger.
function ciWorkflowName(text) {
  const match = /^name:\s*(['"]?)([A-Za-z0-9 _.-]{1,80})\1\s*$/m.exec(normalise(text));
  return match ? match[2].trim() : null;
}

// What the installer wrote at Toolkit commit `at`, or null when that cannot be known here: the commit
// is not in this checkout, the render file differs there from the one running now, or that commit's
// workflow files do not render. Nothing from that commit is run; only its workflow files are read.
function renderAt(id, file, at, root, ci) {
  if (!SHA.test(at) || !git(root, ['cat-file', '-e', `${at}^{commit}`]).ok) return null;
  const then = git(root, ['show', `${at}:${RENDER_FILE}`]);
  if (!then.ok || normalise(then.stdout) !== normalise(fs.readFileSync(require.resolve('./toolkit-cloud-workflows-render.cjs'), 'utf8'))) return null;
  try { return render(id, sourceTexts([file], at, root)(file), at, ci); } catch (error) { if (error instanceof InstallError) return null; throw error; }
}

// The shard ids a test shards copy runs, read from the copy's own matrix lines: { systems }, or
// undefined when they are broken (a hand edit).
function copyShards(text) {
  const systems = {};
  const jobs = text.split(/^(?=  [a-z-]+:$)/m);
  for (const job of jobs) {
    const name = /^  (linux|windows):$/m.exec(job.split('\n')[0]);
    if (!name) continue;
    const lines = [...job.matchAll(/^ {8}shard: (\[[^\n]*\])$/gm)];
    if (lines.length !== 1 || systems[name[1]]) return undefined;
    try {
      const ids = JSON.parse(lines[0][1]);
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !SHARD_ID.test(id) || !id.startsWith(`${name[1]}-`))) return undefined;
      systems[name[1]] = ids;
    } catch { return undefined; }
  }
  return Object.keys(systems).length ? { systems } : undefined;
}

// The default branch a shard copy runs on, from its push trigger (and, for Shard Timings, the same
// --branch on each refresh line), or undefined when those lines are broken (a hand edit).
function copyBranch(id, text) {
  const pushes = [...text.matchAll(/^  push:\n    branches: \[([^\]\n]*)\]$/gm)];
  if (pushes.length !== 1 || !/^[A-Za-z0-9_][A-Za-z0-9._\/-]{0,199}$/.test(pushes[0][1])) return undefined;
  const branch = pushes[0][1];
  if (id === 'shard-timings') {
    const named = [...text.matchAll(/refresh-shard-timings\.cjs --repo-root "\$GITHUB_WORKSPACE" --branch (\S+) /g)];
    if (named.length !== 2 || named.some(([, value]) => value !== branch)) return undefined;
  }
  return branch;
}

// What a copy follows, read from the copy itself: the gate's CI workflow (copyCi), the test shards
// copy's shard ids and branch (copyShards, copyBranch), the Shard Timings copy's branch, or null for a
// copy that follows nothing. Undefined means broken.
function copyInput(id, text) {
  if (id === 'test-shards' || id === 'shard-timings') {
    const branch = copyBranch(id, text);
    const shards = id === 'test-shards' ? copyShards(text) : {};
    return branch === undefined || shards === undefined ? undefined : { ...shards, branch };
  }
  return copyCi(text);
}

// The CI workflow a gate copy follows, read from the copy itself: { file, name }, null when it follows
// none, or undefined when its CI lines are broken (a hand edit).
function copyCi(text) {
  const file = /^ {10}CI_WORKFLOW: (\S+)$/m.exec(text), names = /^ {4}workflows: (\[[^\n]*\])$/m.exec(text);
  if (!file && !names) return null;
  if (!file || !names || !CI_FILE.test(file[1])) return undefined;
  try {
    const list = JSON.parse(names[1]);
    if (Array.isArray(list) && list.length === 1 && typeof list[0] === 'string') return { file: file[1], name: list[0] };
  } catch { /* broken below */ }
  return undefined;
}

// { state: 'current' | 'outdated' | 'edited' | 'unmanaged' | 'missing' } for an installed copy.
// `reference(commit, input)` gives what the installer wrote at the copy's own Toolkit commit for what
// the copy itself follows (copyInput: the CI workflow it names, or its shard ids), or null when that
// cannot be known; with it, a copy that differs from its own render (pins aside) is a hand edit. A CI
// workflow renamed or removed since, or a shard list whose shards changed, only makes the copy
// outdated, because the reference uses the copy's own lines, not the repository's current ones.
function copyState(text, expected, reference = () => null) {
  if (text === null) return { state: 'missing' };
  const normalised = normalise(text);
  const marker = MARKER.exec(normalised);
  if (!marker || normalised.indexOf(marker[0]) !== 0) return { state: 'unmanaged' };
  const body = normalised.slice(marker[0].length + 1);
  const pinned = !marker[4];
  if (bodyHash(body) !== marker[3]) return { state: 'edited', toolkit: marker[2], pinned };
  // The hash leaves pins out, so each pin must still be a full commit SHA: a move to a branch or tag
  // is a hand edit.
  if ([...body.matchAll(/^\s+(?:- )?uses: ([^\n]*)$/gm)].some(([, value]) => !/^[^@\s]+@[0-9a-f]{40}(?: # [^\n]*)?$/.test(value))) return { state: 'edited', toolkit: marker[2], pinned };
  // Every Toolkit checkout must name the Toolkit and its ref: TOOLKIT_REF for a copy with a layout,
  // the header's commit for an older pinned copy. A hash recomputed after changing either is still a
  // hand edit.
  const named = [...body.matchAll(/^ {10}repository: (\S+)\n {10}ref: ([^\n]+)$/gm)];
  if (!named.length || named.some(([, repository, ref]) => repository !== TOOLKIT_REPOSITORY || ref !== (pinned ? marker[2] : TOOLKIT_REF))) return { state: 'edited', toolkit: marker[2], pinned };
  // Stale means the layout only: a copy whose body is what a refresh writes now is current, whichever
  // Toolkit commit rendered it, because it runs Toolkit main either way.
  if (Number(marker[4]) === LAYOUT && body === expected.slice(expected.indexOf('\n') + 1)) return { state: 'current', toolkit: marker[2], pinned };
  const input = copyInput(marker[1], body);
  if (input === undefined) return { state: 'edited', toolkit: marker[2], pinned };
  // A copy from before layouts was made by an older render, so only its hash can be checked.
  const own = pinned ? null : reference(marker[2], input);
  if (own !== null && withoutPins(normalised) !== withoutPins(normalise(own))) return { state: 'edited', toolkit: marker[2], pinned };
  return { state: 'outdated', toolkit: marker[2], pinned };
}

function readOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function parseArgs(argv) {
  const options = { repo: null, ci: null, check: false, refreshPr: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo' || arg === '--ci-workflow') {
      const value = argv[index += 1];
      if (!value) throw new InstallError(`${arg} needs a value.`);
      if (arg === '--repo') options.repo = value; else options.ci = value;
    } else if (arg === '--check') options.check = true;
    else if (arg === '--refresh-pr') options.refreshPr = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new InstallError(`unknown argument ${arg}.`);
  }
  if (!options.help && !options.repo) throw new InstallError('--repo is required.');
  if (options.check && options.refreshPr) throw new InstallError('choose --check or --refresh-pr, not both.');
  if (options.ci && !CI_FILE.test(options.ci)) throw new InstallError('--ci-workflow takes a workflow file name such as ci.yml.');
  return options;
}

// The plan for one repository: each workflow's path, expected text and current state.
// `ciShards` is the merged binding's ci_shards answer ('yes', 'not-now', 'never' or null); by default it
// is read from this computer's copy of the merged binding. `defaultBranch` is given when `repo` is a
// snapshot of the default branch's files (the refresh pull request's), not a git checkout.
function plan({ repo, ci = null, root = sourceRoot(), commit = toolkitCommit(root), ciShards = undefined, defaultBranch = null }) {
  const target = path.resolve(repo);
  if (!defaultBranch && !fs.existsSync(path.join(target, '.git'))) throw new InstallError(`${target} is not a git checkout.`);
  if (isToolkitCheckout(target)) {
    throw new InstallError('this is a Toolkit source checkout, which runs its own workflow files.');
  }
  // The sweep and its gate run only on main, so on another default branch they are left out, and the
  // shard copies with them (they are rendered for the default branch all the same, so they are ready for
  // one). The copied workflows run on any default branch.
  const head = defaultBranch ? '' : git(target, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).stdout.trim();
  const branch = defaultBranch || (head ? head.replace('refs/remotes/origin/', '') : 'main');
  const offMain = branch === 'main' ? null : `the default branch is ${branch}; the cloud sweep runs only on a main branch`;
  // Without --ci-workflow, an installed gate copy keeps the CI workflow it already follows, while that
  // workflow is still there with a plain name; otherwise the CI trigger is left out.
  if (!ci) {
    const installed = readOrNull(path.join(target, ...GATE.file.split('/')));
    const kept = installed && MARKER.test(normalise(installed)) ? /^ {10}CI_WORKFLOW: (\S+)$/m.exec(normalise(installed)) : null;
    const keptText = kept && CI_FILE.test(kept[1]) ? readOrNull(path.join(target, '.github', 'workflows', kept[1])) : null;
    if (keptText !== null && ciWorkflowName(keptText)) ci = kept[1];
  }
  let ciWorkflow = null;
  if (ci) {
    const text = readOrNull(path.join(target, '.github', 'workflows', ci));
    if (text === null) throw new InstallError(`.github/workflows/${ci} is missing, so the gate cannot follow it.`);
    const name = ciWorkflowName(text);
    if (!name) throw new InstallError(`.github/workflows/${ci} has no plain name: line for the gate to follow.`);
    ciWorkflow = { file: ci, name };
  }
  const answer = ciShards === undefined ? mergedCiShards(target) : ciShards;
  const shards = offMain ? { rows: [], renamed: [], notCopied: SHARD_WORKFLOWS.map(row => ({ id: row.id, reason: offMain })) } : shardCopies(target, branch, answer);
  const wanted = [...(offMain ? [] : SWEEPS.map(row => ({ ...row, input: ciWorkflow }))), ...shards.rows];
  const sourceAt = sourceTexts([...new Set([...wanted.map(row => row.source), ...COPIED_SOURCES])], commit, root);
  const rendered = wanted.map(({ id, file, source, input, consequence }) => {
    const expected = render(id, sourceAt(source), commit, input);
    const absolute = path.join(target, ...file.split('/'));
    // The copy's own commit, re-rendered with what the copy itself follows.
    const reference = (at, own) => {
      if (at !== commit) return renderAt(id, source, at, root, own);
      try { return render(id, sourceAt(source), commit, own); } catch (error) { if (error instanceof InstallError) return null; throw error; }
    };
    return { id, file, absolute, expected, kind: 'rendered', consequence, ...copyState(readOrNull(absolute), expected, reference) };
  });
  const copied = DEFAULT_CLOUD_WORKFLOWS.filter(row => row.kind === 'copied').flatMap(row => copiedRows(row, target, sourceAt));
  // In the list's own order.
  const rows = DEFAULT_CLOUD_WORKFLOWS.flatMap(({ id }) => [...rendered, ...copied].filter(row => row.id === id));
  const notCopied = [...(offMain ? SWEEPS.map(row => ({ id: row.id, reason: offMain })) : []), ...shards.notCopied];
  return { target, commit, ci: ciWorkflow, ci_shards: answer || null, rows, not_copied: notCopied, renamed: shards.renamed };
}

// The rows to write from a plan: every one but the files of a copied workflow that clashes with a file
// Toolkit did not write. A rendered copy's path that holds someone else's file stops the whole install.
function writableRows(rows) {
  const unmanaged = rows.find(row => row.kind !== 'copied' && row.state === 'unmanaged');
  if (unmanaged) throw new InstallError(`${unmanaged.file} exists and is not a Toolkit copy; move it aside first.`);
  return rows.filter(row => row.state !== 'unmanaged' && !row.held);
}

// What a clash with someone else's file leaves out, one line per workflow.
function clashNotes(rows) {
  return rows.filter(row => row.kind === 'copied' && row.state === 'unmanaged').map(row => clashNote(row.file, row.id));
}

// What a pull request says it leaves out: those clashes, and the sweep where it cannot run.
function leftOutNotes({ rows, not_copied: notCopied = [] }) {
  const sweep = notCopied.find(row => row.id === SWEEPS[0].id);
  return [...clashNotes(rows), ...(sweep ? [`The cloud sweep and its gate are left out: ${sweep.reason}.`] : [])];
}

// Whether a refresh would change this row.
const refreshable = row => row.state !== 'current' && !row.held && !(row.kind === 'copied' && row.state === 'unmanaged');

// The merged binding's ci_shards answer on this computer, or null when there is none to read.
function mergedCiShards(target) {
  try { return require('./toolkit-governance-state.cjs').mergedBinding(target)?.ci_shards?.answer || null; } catch { return null; }
}

// The shard copies for a repository: both rows when its shard list is usable, otherwise none, each
// named in not_copied with the reason. A Toolkit copy still there from an earlier list is named too.
function shardCopies(target, branch = 'main', answer = null) {
  const list = governedShards.listState(target);
  const workflow = list.manifest?.workflow || governedShards.DEFAULT_WORKFLOW;
  let reason = null;
  if (answer === 'never') reason = 'the merged binding answers never to parallel CI shards (ci_shards)';
  else if (answer !== 'yes') reason = 'the merged binding has no yes to parallel CI shards (ci_shards); say refresh governance to answer it';
  else if (list.state === 'missing') reason = `the repository has no shard list at ${governedShards.MANIFEST_REL}`;
  else if (list.state === 'invalid') reason = `the shard list ${governedShards.MANIFEST_REL} is not usable (${String(list.errors[0]).split('\n').pop().replace(/^- /, '').replace(/\.$/, '')})`;
  else if (governedShards.unsupportedPrograms(list.manifest).length) reason = `the shard list runs ${governedShards.unsupportedPrograms(list.manifest).join(', ')}, and the copied shard jobs set up Node only, so its tests could not run there yet; use a node command or keep the tests in the repository's own CI`;
  else if (RESERVED.has(workflow)) reason = `the shard list names ${workflow} for its workflow, a file another Toolkit copy uses`;
  if (!reason) {
    const input = { systems: governedShards.shardIds(list.manifest), branch };
    // A test shards copy at another name, from before the list renamed its workflow, runs on as well.
    const renamed = markedCopies(target).filter(copy => copy.id === 'test-shards' && copy.file !== `.github/workflows/${workflow}`).map(copy => ({ id: copy.id, file: copy.file, workflow: `.github/workflows/${workflow}` }));
    return { notCopied: [], renamed, rows: SHARD_WORKFLOWS.map(row => ({ ...row, ...(row.id === 'test-shards' ? { file: `.github/workflows/${workflow}`, input } : { input: { branch } }) })) };
  }
  // A Toolkit copy an earlier, usable list brought is found by its marker (the test shards copy at any
  // name) and named, so the governance check can report it.
  const marked = markedCopies(target);
  const notCopied = SHARD_WORKFLOWS.map(row => {
    const left = marked.filter(copy => copy.id === row.id).map(copy => copy.file);
    return { id: row.id, reason, ...(left.length ? { left } : {}) };
  });
  return { notCopied, rows: [], renamed: [] };
}

// The Toolkit copy a workflow file is, from its first line: the copy's id when the file starts with the
// rendered-copy marker of a known copy at a path that copy can have, otherwise null. Every copy has a
// fixed path except the test shards workflow, which goes to the name its shard list chose, so a copy
// is found by its marker, not only by the fixed file list.
const COPY_IDS = new Set(RENDERED.map(row => row.id));
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/;
function copyIdAt(file, text) {
  if (!WORKFLOW_PATH.test(file) || typeof text !== 'string') return null;
  const normalised = normalise(text);
  const marker = MARKER.exec(normalised);
  if (!marker || normalised.indexOf(marker[0]) !== 0 || !COPY_IDS.has(marker[1])) return null;
  const fixed = RENDERED.find(row => row.id === marker[1] && row.id !== 'test-shards');
  return !fixed || fixed.file === file ? marker[1] : null;
}

// The workflow files a rules refresh may look at for Toolkit copies: every fixed copy path plus each
// .yml or .yaml file in .github/workflows (`names` lists that folder; null when it cannot be read).
function copyCandidates(names) {
  const fixed = RENDERED.map(row => row.file);
  const listed = (names || []).filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(name)).map(name => `.github/workflows/${name}`).filter(file => !fixed.includes(file)).sort();
  return [...fixed, ...listed];
}

// The Toolkit copies in a checkout, found by marker: [{ id, file, edited }]. Links and other
// non-regular files are never read.
function markedCopies(root) {
  let names = null;
  try { names = fs.readdirSync(path.join(root, '.github', 'workflows')); } catch { names = null; }
  const found = [];
  for (const file of copyCandidates(names)) {
    const absolute = path.join(root, ...file.split('/'));
    let text;
    try { if (!fs.lstatSync(absolute).isFile()) continue; text = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    const id = copyIdAt(file, text);
    if (!id) continue;
    const normalised = normalise(text), marker = MARKER.exec(normalised);
    found.push({ id, file, edited: bodyHash(normalised.slice(marker[0].length + 1)) !== marker[3] });
  }
  return found;
}

function apply(result) {
  for (const row of writableRows(result.rows)) {
    if (row.state === 'current') continue;
    fs.mkdirSync(path.dirname(row.absolute), { recursive: true });
    fs.writeFileSync(row.absolute, row.expected);
    row.written = true;
  }
  return result;
}

function report(result, check) {
  const lines = [`Toolkit cloud workflows for ${result.target} at Toolkit ${result.commit.slice(0, 7)}${result.ci ? `, gate follows ${result.ci.file}` : ', gate has no CI trigger'}:`];
  for (const row of result.rows) lines.push(`- ${row.file}: ${row.written ? `written (was ${row.state})` : row.held ? `${row.state}, not added` : row.state}${!check || row.state === 'current' || row.held ? '' : row.state === 'unmanaged' ? '; not a Toolkit copy' : '; refresh the repository rules to fix it'}`);
  for (const note of clashNotes(result.rows)) lines.push(`- ${note}`);
  for (const row of result.not_copied) lines.push(`- ${row.id}: not copied, ${row.reason}${row.left ? `; the Toolkit copy at ${row.left.join(', ')} is left as it was` : ''}.`);
  return lines.join('\n');
}

// `refresh` reads the merged binding again before its ci_shards answer is used, so a copy step run
// after the answer merged does not act on this computer's older read.
// `github` and `governance` are for tests of --refresh-pr (toolkit-cloud-workflows-refresh.cjs).
function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr, root = sourceRoot(), commit, ciShards, refresh = target => require('./toolkit-governance-state.cjs').refreshMergedBinding(target), github, governance } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { err.write(`Not installed: ${error.message}\n${USAGE}\n`); return 2; }
  if (options.help) { out.write(`${USAGE}\n`); return 0; }
  if (ciShards === undefined || options.refreshPr) { try { refresh(path.resolve(options.repo)); } catch { /* the last read stays */ } }
  if (options.refreshPr) {
    const result = require('./toolkit-cloud-workflows-refresh.cjs').refreshPr({ repo: options.repo, ci: options.ci, root, commit, ciShards, workflows: module.exports, ...(github ? { github } : {}), ...(governance ? { governance } : {}) });
    (result.code ? err : out).write(`${result.line}\n`);
    return result.code;
  }
  try {
    const result = plan({ repo: options.repo, ci: options.ci, root, ...(commit ? { commit } : {}), ...(ciShards !== undefined ? { ciShards } : {}) });
    if (!options.check) apply(result);
    const drift = options.check && result.rows.some(row => row.state !== 'current');
    if (options.json) out.write(`${JSON.stringify({ toolkit: result.commit, ci: result.ci, workflows: result.rows.map(({ id, file, state, written }) => ({ id, file, state, written: Boolean(written) })), not_copied: result.not_copied })}\n`);
    else out.write(`${report(result, options.check)}\n`);
    return drift ? 1 : 0;
  } catch (error) {
    if (!(error instanceof InstallError)) throw error;
    err.write(`Not installed: ${error.message}\n`);
    return 2;
  }
}

module.exports = Object.freeze({ installerAt, isToolkitClone, sourceRoot, TOOLKIT_REPOSITORY, toolkitHead, isToolkitCheckout, TOOLKIT_PATH, DEFAULT_CLOUD_WORKFLOWS, DEFAULT_FILES, MARKER, InstallError, leftOutNotes, refreshable, writableRows, copyCandidates, copyIdAt, markedCopies, apply, bodyHash, ciWorkflowName, copyState, main, parseArgs, plan, render, toolkitCommit });

if (require.main === module) process.exitCode = main();
