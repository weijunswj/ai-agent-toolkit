#!/usr/bin/env node
'use strict';

// Copies the Toolkit's cloud workflows into a governed repository, so its programme board refreshes
// on GitHub instead of on a computer.
//
// The copies are rendered from the Toolkit's own workflow files at the commit this checkout is on,
// read from git, never from the working tree. Each copy checks the Toolkit out at that same commit
// into `.toolkit/` (public, no token) and runs the scripts from there, while the binding and the
// working folder stay the governed repository's own. The render itself is
// toolkit-cloud-workflows-render.cjs; its header says what it changes. Each copy carries a managed
// header line naming the Toolkit commit and the copy's hash, so --check can tell a current copy from
// a stale or hand-edited one. A copy from an older commit is also re-rendered at that commit, when
// this checkout has it and the render file is unchanged since, so an edit whose hash was recomputed
// still shows.
//
// Programme Sweep and its gate go to every governed repository. The test shards workflow and Shard
// Timings go only to a repository with a usable shard list (.github/toolkit-test-shards.json, see
// governed-test-shards.cjs); without one this script says they were not copied and why. The test
// shards copy carries the list's shard ids in its matrix, so a change to the list's shards makes the
// copy outdated (a rules refresh rewrites it), never edited.
//
// Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check] [--json]
// Exit codes: 0 done (or no drift), 1 drift found by --check, 2 not installed (the reason is printed).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TOOLKIT_REPOSITORY, TOOLKIT_PATH, MARKER, SHA, SHARD_ID, InstallError, normalise, withoutPins, bodyHash, render } = require('./toolkit-cloud-workflows-render.cjs');
const governedShards = require('./governed-test-shards.cjs');

const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const RENDER_FILE = 'repo/scripts/toolkit-cloud-workflows-render.cjs';
const WORKFLOWS = Object.freeze([
  Object.freeze({ id: 'programme-sweep', file: '.github/workflows/toolkit-programme-sweep.yml' }),
  Object.freeze({ id: 'programme-sweep-gate', file: '.github/workflows/toolkit-programme-sweep-gate.yml' }),
]);
// Copied only where the repository has a usable shard list. The test shards copy goes to the file the
// list's `workflow` names (default toolkit-test-shards.yml) and is rendered from a Toolkit template
// that runs nowhere in the Toolkit itself.
const SHARD_WORKFLOWS = Object.freeze([
  Object.freeze({ id: 'test-shards', source: 'repo/contracts/ci/governed-test-shards.yml', file: `.github/workflows/${governedShards.DEFAULT_WORKFLOW}` }),
  Object.freeze({ id: 'shard-timings', source: '.github/workflows/toolkit-shard-timings.yml', file: '.github/workflows/toolkit-shard-timings.yml' }),
]);
// What a copy that drifted costs the repository, for the governance check.
const CONSEQUENCE = Object.freeze({
  'programme-sweep': 'this repository\'s programme board gets no cloud sweep',
  'programme-sweep-gate': 'this repository\'s programme board gets no cloud sweep',
  'test-shards': 'this repository\'s Toolkit test shards and their gate do not run as the Toolkit wrote them',
  'shard-timings': 'this repository\'s test shard timings are not refreshed as the Toolkit wrote them',
});
const RESERVED = new Set([...WORKFLOWS, ...SHARD_WORKFLOWS].map(row => row.file.slice('.github/workflows/'.length)).filter(name => name !== governedShards.DEFAULT_WORKFLOW));
const CI_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const USAGE = 'Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check] [--json]';

const TOOLKIT_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)weijunswj\/ai-agent-toolkit(?:\.git)?\/?$/i;
// A Toolkit source checkout runs its own workflow files. This file has been there far longer than
// the installer, so older Toolkit branches are recognised too.
const isToolkitCheckout = dir => fs.existsSync(path.join(dir, 'repo', 'scripts', 'toolkit-governance-conformance.cjs'));

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, stdout: String(result.stdout || '') };
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

function sourceText(file, commit, root = TOOLKIT_ROOT) {
  const result = git(root, ['show', `${commit}:${file}`]);
  if (!result.ok) throw new InstallError(`${file} is missing at Toolkit commit ${commit.slice(0, 7)}.`);
  return normalise(result.stdout);
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
  try { return render(id, sourceText(file, at, root), at, ci); } catch (error) { if (error instanceof InstallError) return null; throw error; }
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

// What a copy follows, read from the copy itself: the gate's CI workflow (copyCi), the test shards
// copy's shard ids (copyShards), or null for a copy that follows nothing. Undefined means broken.
function copyInput(id, text) {
  if (id === 'test-shards') return copyShards(text);
  if (id === 'shard-timings') return null;
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
  if (bodyHash(body) !== marker[3]) return { state: 'edited', toolkit: marker[2] };
  // The hash leaves pins out, so each pin must still be a full commit SHA: a move to a branch or tag
  // is a hand edit.
  if ([...body.matchAll(/^\s+(?:- )?uses: ([^\n]*)$/gm)].some(([, value]) => !/^[^@\s]+@[0-9a-f]{40}(?: # [^\n]*)?$/.test(value))) return { state: 'edited', toolkit: marker[2] };
  // Every Toolkit checkout must name the Toolkit and the commit in the header; a hash recomputed after
  // changing either is still a hand edit.
  const named = [...body.matchAll(/^ {10}repository: (\S+)\n {10}ref: (\S+)$/gm)];
  if (!named.length || named.some(([, repository, ref]) => repository !== TOOLKIT_REPOSITORY || ref !== marker[2])) return { state: 'edited', toolkit: marker[2] };
  if (normalised === expected) return { state: 'current', toolkit: marker[2] };
  const input = copyInput(marker[1], body);
  if (input === undefined) return { state: 'edited', toolkit: marker[2] };
  const own = reference(marker[2], input);
  if (own !== null && withoutPins(normalised) !== withoutPins(normalise(own))) return { state: 'edited', toolkit: marker[2] };
  return { state: 'outdated', toolkit: marker[2] };
}

function readOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function parseArgs(argv) {
  const options = { repo: null, ci: null, check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo' || arg === '--ci-workflow') {
      const value = argv[index += 1];
      if (!value) throw new InstallError(`${arg} needs a value.`);
      if (arg === '--repo') options.repo = value; else options.ci = value;
    } else if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new InstallError(`unknown argument ${arg}.`);
  }
  if (!options.help && !options.repo) throw new InstallError('--repo is required.');
  if (options.ci && !CI_FILE.test(options.ci)) throw new InstallError('--ci-workflow takes a workflow file name such as ci.yml.');
  return options;
}

// The plan for one repository: each workflow's path, expected text and current state.
function plan({ repo, ci = null, root = TOOLKIT_ROOT, commit = toolkitCommit(root) }) {
  const target = path.resolve(repo);
  if (!fs.existsSync(path.join(target, '.git'))) throw new InstallError(`${target} is not a git checkout.`);
  if (isToolkitCheckout(target)) {
    throw new InstallError('this is a Toolkit source checkout, which runs its own workflow files.');
  }
  const head = git(target, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).stdout.trim();
  if (head && head !== 'refs/remotes/origin/main') throw new InstallError(`the default branch is ${head.replace('refs/remotes/origin/', '')}; the cloud sweep runs only on a main branch.`);
  // Without --ci-workflow, an installed gate copy keeps the CI workflow it already follows, while that
  // workflow is still there with a plain name; otherwise the CI trigger is left out.
  if (!ci) {
    const installed = readOrNull(path.join(target, ...WORKFLOWS[1].file.split('/')));
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
  const shards = shardCopies(target);
  const wanted = [...WORKFLOWS.map(row => ({ ...row, input: ciWorkflow })), ...shards.rows];
  const rows = wanted.map(({ id, file, source = file, input }) => {
    const expected = render(id, sourceText(source, commit, root), commit, input);
    const absolute = path.join(target, ...file.split('/'));
    // The copy's own commit, re-rendered with what the copy itself follows.
    const reference = (at, own) => {
      if (at !== commit) return renderAt(id, source, at, root, own);
      try { return render(id, sourceText(source, commit, root), commit, own); } catch (error) { if (error instanceof InstallError) return null; throw error; }
    };
    return { id, file, absolute, expected, consequence: CONSEQUENCE[id], ...copyState(readOrNull(absolute), expected, reference) };
  });
  return { target, commit, ci: ciWorkflow, rows, not_copied: shards.notCopied };
}

// The shard copies for a repository: both rows when its shard list is usable, otherwise none, each
// named in not_copied with the reason. A Toolkit copy still there from an earlier list is named too.
function shardCopies(target) {
  const list = governedShards.listState(target);
  const workflow = list.manifest?.workflow || governedShards.DEFAULT_WORKFLOW;
  let reason = null;
  if (list.state === 'missing') reason = `the repository has no shard list at ${governedShards.MANIFEST_REL}`;
  else if (list.state === 'invalid') reason = `the shard list ${governedShards.MANIFEST_REL} is not usable (${String(list.errors[0]).split('\n').pop().replace(/^- /, '').replace(/\.$/, '')})`;
  else if (RESERVED.has(workflow)) reason = `the shard list names ${workflow} for its workflow, a file another Toolkit copy uses`;
  if (!reason) {
    const input = { systems: governedShards.shardIds(list.manifest) };
    return { notCopied: [], rows: SHARD_WORKFLOWS.map(row => ({ ...row, ...(row.id === 'test-shards' ? { file: `.github/workflows/${workflow}`, input } : { input: null }) })) };
  }
  const notCopied = SHARD_WORKFLOWS.map(row => {
    const left = row.id === 'test-shards' ? `.github/workflows/${workflow}` : row.file;
    const text = readOrNull(path.join(target, ...left.split('/')));
    const marked = text !== null && MARKER.exec(normalise(text))?.[1] === row.id;
    return { id: row.id, reason: marked ? `${reason}; the Toolkit copy at ${left} is left as it was` : reason };
  });
  return { notCopied, rows: [] };
}

function apply(result) {
  for (const row of result.rows) {
    if (row.state === 'current') continue;
    if (row.state === 'unmanaged') throw new InstallError(`${row.file} exists and is not a Toolkit copy; move it aside first.`);
    fs.mkdirSync(path.dirname(row.absolute), { recursive: true });
    fs.writeFileSync(row.absolute, row.expected);
    row.written = true;
  }
  return result;
}

function report(result, check) {
  const lines = [`Toolkit cloud workflows for ${result.target} at Toolkit ${result.commit.slice(0, 7)}${result.ci ? `, gate follows ${result.ci.file}` : ', gate has no CI trigger'}:`];
  for (const row of result.rows) lines.push(`- ${row.file}: ${row.written ? `written (was ${row.state})` : row.state}${!check || row.state === 'current' ? '' : row.state === 'unmanaged' ? '; not a Toolkit copy' : '; refresh the repository rules to fix it'}`);
  for (const row of result.not_copied) lines.push(`- ${row.id}: not copied, ${row.reason}.`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr, root = TOOLKIT_ROOT, commit } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { err.write(`Not installed: ${error.message}\n${USAGE}\n`); return 2; }
  if (options.help) { out.write(`${USAGE}\n`); return 0; }
  try {
    const result = plan({ repo: options.repo, ci: options.ci, root, ...(commit ? { commit } : {}) });
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

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ TOOLKIT_REPOSITORY, toolkitHead, isToolkitCheckout, TOOLKIT_PATH, WORKFLOWS, SHARD_WORKFLOWS, MARKER, InstallError, apply, bodyHash, ciWorkflowName, copyState, main, parseArgs, plan, render, toolkitCommit });
