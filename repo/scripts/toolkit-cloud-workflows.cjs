#!/usr/bin/env node
'use strict';

// Copies the Toolkit's cloud workflows into a governed repository, so its programme board refreshes
// on GitHub instead of on a computer.
//
// The copies are rendered from the Toolkit's own workflow files at the commit this checkout is on,
// read from git, never from the working tree. Each copy checks the Toolkit out at that same commit
// into `.toolkit/` (public, no token) and runs the scripts from there, while the binding and the
// working folder stay the governed repository's own. The render changes only:
//   - a managed header line naming the Toolkit commit and the copy's hash, so --check can tell a
//     current copy from a stale or hand-edited one,
//   - each Toolkit-script checkout, which names the Toolkit repository, the pinned commit and `.toolkit/`,
//   - `node repo/scripts/` paths, which become `node .toolkit/repo/scripts/`,
//   - the gate's CI trigger, which follows the repository's own CI workflow or is left out.
// A source file that no longer matches what the render expects stops it, so a change to the
// workflows breaks the tests instead of producing a wrong copy.
//
// Programme Sweep and its gate go to every governed repository. Shard Timings needs the Toolkit's
// test-shard manifest and run summaries, so it is not copied; this script says so.
//
// Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check] [--json]
// Exit codes: 0 done (or no drift), 1 drift found by --check, 2 not installed (the reason is printed).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const TOOLKIT_REPOSITORY = 'weijunswj/ai-agent-toolkit';
const TOOLKIT_PATH = '.toolkit';
const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
const WORKFLOWS = Object.freeze([
  Object.freeze({ id: 'programme-sweep', file: '.github/workflows/toolkit-programme-sweep.yml' }),
  Object.freeze({ id: 'programme-sweep-gate', file: '.github/workflows/toolkit-programme-sweep-gate.yml' }),
]);
const NOT_COPIED = Object.freeze([
  Object.freeze({ id: 'shard-timings', file: '.github/workflows/toolkit-shard-timings.yml', reason: 'it needs the Toolkit\'s test-shard manifest and run summaries' }),
]);
const MARKER = /^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ([a-z-]+) toolkit=([0-9a-f]{40}) sha256=([0-9a-f]{12})$/m;
const SHA = /^[0-9a-f]{40}$/;
const NOTE = '# A copy of the Toolkit\'s own workflow, pinned to the Toolkit commit above. Do not edit it here: refresh the repository rules to update it.';
const CI_FILE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const USAGE = 'Usage: node repo/scripts/toolkit-cloud-workflows.cjs --repo <dir> [--ci-workflow <file>] [--check] [--json]';

class InstallError extends Error {
  constructor(message) { super(message); this.name = 'InstallError'; }
}

const sha12 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
// The copy's hash leaves out each action's pinned version, so a Dependabot bump of a `uses:` pin reads
// as an older copy (the next refresh puts the Toolkit's pins back), not as a hand edit.
const bodyHash = body => sha12(body.replace(/^(\s+uses: [^@\s]+)@[^\n]*$/gm, '$1'));
const TOOLKIT_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)weijunswj\/ai-agent-toolkit(?:\.git)?\/?$/i;
// A Toolkit source checkout runs its own workflow files. This file has been there far longer than
// the installer, so older Toolkit branches are recognised too.
const isToolkitCheckout = dir => fs.existsSync(path.join(dir, 'repo', 'scripts', 'toolkit-governance-conformance.cjs'));
const normalise = text => String(text).replace(/\r\n/g, '\n');

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

function replaceOnce(text, from, to, what) {
  const at = text.indexOf(from);
  if (at === -1 || text.indexOf(from, at + 1) !== -1) throw new InstallError(`the Toolkit's workflow changed shape (${what}); the render needs an update.`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

// The name: line of the repository's CI workflow, for the gate's workflow_run trigger.
function ciWorkflowName(text) {
  const match = /^name:\s*(['"]?)([A-Za-z0-9 _.-]{1,80})\1\s*$/m.exec(normalise(text));
  return match ? match[2].trim() : null;
}

function renderBody(id, source, commit, ci) {
  const toolkitScript = `        with:\n          repository: ${TOOLKIT_REPOSITORY}\n          ref: ${commit}\n          path: ${TOOLKIT_PATH}\n`;
  let text = source;
  if (id === 'programme-sweep') {
    text = replaceOnce(text, '      - name: Check out this run\'s commit\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n',
      '      - name: Check out this run\'s commit\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n\n'
      + '      - name: Check out the Toolkit\n        uses: ' + CHECKOUT + '\n' + toolkitScript + '          persist-credentials: false\n', 'sweep checkout');
    text = replaceOnce(text, '      - name: Check out the follow-up script\n        uses: ' + CHECKOUT + '\n        with:\n          ref: ${{ github.sha }}\n',
      '      - name: Check out the follow-up script\n        uses: ' + CHECKOUT + '\n' + toolkitScript, 'follow-up checkout');
  } else {
    text = replaceOnce(text, '      - name: Check out the gate from main\n        uses: ' + CHECKOUT + '\n        with:\n          ref: main\n',
      '      - name: Check out the gate from the Toolkit\n        uses: ' + CHECKOUT + '\n' + toolkitScript, 'gate checkout');
    if (ci) {
      text = replaceOnce(text, '    workflows: [Validate]\n', `    workflows: [${JSON.stringify(ci.name)}]\n`, 'gate CI trigger');
      text = replaceOnce(text, '          CI_WORKFLOW: validate.yml\n', `          CI_WORKFLOW: ${ci.file}\n`, 'gate CI workflow');
    } else {
      text = replaceOnce(text, '  workflow_run:\n    workflows: [Validate]\n    types: [completed]\n', '', 'gate CI trigger');
      text = replaceOnce(text, '          CI_WORKFLOW: validate.yml\n', '', 'gate CI workflow');
    }
  }
  const scripts = (text.match(/node repo\/scripts\//g) || []).length;
  if (!scripts) throw new InstallError(`the Toolkit's workflow changed shape (${id} runs no Toolkit script); the render needs an update.`);
  text = text.replace(/node repo\/scripts\//g, `node ${TOOLKIT_PATH}/repo/scripts/`);
  return text;
}

// The rendered copy: one managed header line, then the body.
function render(id, source, commit, ci = null) {
  if (!SHA.test(commit)) throw new InstallError('the Toolkit commit must be a full 40-character SHA.');
  const body = `${NOTE}\n${renderBody(id, normalise(source), commit, ci)}`;
  return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${commit} sha256=${bodyHash(body)}\n${body}`;
}

// { state: 'current' | 'outdated' | 'edited' | 'unmanaged' | 'missing' } for an installed copy.
function copyState(text, expected) {
  if (text === null) return { state: 'missing' };
  const normalised = normalise(text);
  const marker = MARKER.exec(normalised);
  if (!marker || normalised.indexOf(marker[0]) !== 0) return { state: 'unmanaged' };
  const body = normalised.slice(marker[0].length + 1);
  if (bodyHash(body) !== marker[3]) return { state: 'edited', toolkit: marker[2] };
  // Every Toolkit checkout must name the Toolkit and the commit in the header; a hash recomputed after
  // changing either is still a hand edit.
  const named = [...body.matchAll(/^ {10}repository: (\S+)\n {10}ref: (\S+)$/gm)];
  if (!named.length || named.some(([, repository, ref]) => repository !== TOOLKIT_REPOSITORY || ref !== marker[2])) return { state: 'edited', toolkit: marker[2] };
  return normalised === expected ? { state: 'current', toolkit: marker[2] } : { state: 'outdated', toolkit: marker[2] };
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
  const rows = WORKFLOWS.map(({ id, file }) => {
    const expected = render(id, sourceText(file, commit, root), commit, ciWorkflow);
    const absolute = path.join(target, ...file.split('/'));
    return { id, file, absolute, expected, ...copyState(readOrNull(absolute), expected) };
  });
  return { target, commit, ci: ciWorkflow, rows, not_copied: NOT_COPIED.map(({ id, reason }) => ({ id, reason })) };
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

module.exports = Object.freeze({ TOOLKIT_REPOSITORY, toolkitHead, isToolkitCheckout, TOOLKIT_PATH, WORKFLOWS, NOT_COPIED, InstallError, apply, ciWorkflowName, copyState, main, parseArgs, plan, render, toolkitCommit });
