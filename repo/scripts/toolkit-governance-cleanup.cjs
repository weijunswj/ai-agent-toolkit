#!/usr/bin/env node
'use strict';

// The cleanup route for a repository whose governance is on. The installed Toolkit gives its sessions
// the governed rules and the playbooks, so the copies older setups wrote are leftovers. This removes
// exactly what the leftover scan (toolkit-leftover-files.cjs) proves is Toolkit's, in the working tree:
//   - a governed-rules block in AGENTS.md, the Antigravity bootstrap block, an older n8n block or a
//     marked GEMINI.md shim, keeping every byte outside the markers; a file left with nothing of the
//     owner's is deleted;
//   - a one-line CLAUDE.md, only when AGENTS.md has nothing of its own left; an older marked CLAUDE.md
//     shim is replaced by the line `@AGENTS.md` while AGENTS.md has text of its own, else goes the same way;
//   - docs/agent-playbooks/ files that are a copy Toolkit shipped, now or earlier;
//   - retired workflow copies: a Toolkit test shards or Shard Timings workflow (Toolkit no longer sets up
//     CI shards, and the rules refresh removes them too).
// It also sets `min_toolkit` in the programme file, so a Toolkit copy too old to deliver the rules
// says to update instead of running without them. The checks and workflow copies governance uses,
// and anything not proven Toolkit's, stay. It never runs git: the changes go to the owner in one pull
// request per repository, which the owner merges (never task auto-merge, because it deletes files).
//
// Usage: node repo/scripts/toolkit-governance-cleanup.cjs [--repo <folder>] [--write]
// Without --write it only shows what would change.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const blocks = require('./toolkit-managed-block.cjs');
const { LeftoverScan, withoutCuratedHeader } = require('./toolkit-leftover-files.cjs');

// The floor a cleaned repository needs: the first release whose installed Toolkit gives sessions the
// governed rules whole (with the session-start truncation fix), turns governance on without writing
// rule copies and runs this cleanup. A copy that knows the key and is older says to update; a copy
// older than the key reads the binding as ERROR, which also holds governance effects while ordinary
// work continues. Toolkit's own binding carries the same floor.
const MIN_TOOLKIT = '3.137.0';
const BINDING_FILE = '.github/toolkit-programme.json';
const SHIM_LINE = '@AGENTS.md';
const USAGE = 'Usage: node repo/scripts/toolkit-governance-cleanup.cjs [--repo <folder>] [--write]';

// A governed repository's sweep copies run the Toolkit commit they are pinned to, which reads the
// programme file with its own validator: a commit whose validator does not know min_toolkit reads the
// cleaned file as invalid and the sweep stops updating the programme board. A commit this Toolkit copy
// cannot read is not checked, so it holds the cleanup too. Returns { tooOld, unchecked }.
const STATE_SCRIPT = 'skills/github-program-reconciler/scripts/programme-state.cjs';
const SWEEP_IDS = Object.freeze(['programme-sweep', 'programme-sweep-gate']);

// The Toolkit copies of the sweep in `root` still pinned to one commit (from before layouts) that may
// not read a binding key: { tooOld, unchecked }. `reads(commit, git)` says whether the Toolkit at that
// commit does (tooOld when not). A copy whose commit this Toolkit copy cannot read (not a git checkout,
// or the commit is not in it) is unchecked; the caller holds for both, and says which is which.
function oldSweepCopies(root, toolkitRoot, reads) {
  const workflows = require('./toolkit-cloud-workflows.cjs');
  const git = args => spawnSync('git', args, { cwd: toolkitRoot, windowsHide: true, shell: false, encoding: 'utf8' });
  const tooOld = [], unchecked = [];
  for (const copy of workflows.markedCopies(root).filter(entry => SWEEP_IDS.includes(entry.id))) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, ...copy.file.split('/')), 'utf8'); } catch { text = ''; }
    const marker = workflows.MARKER.exec(text.replace(/\r\n/g, '\n'));
    // A copy with a layout runs Toolkit main, which reads every binding key this Toolkit knows.
    if (marker?.[4]) continue;
    const commit = marker?.[2];
    const known = commit && git(['cat-file', '-e', `${commit}^{commit}`]).status === 0;
    if (!known) unchecked.push(copy.file);
    else if (!reads(commit, git)) tooOld.push(copy.file);
  }
  return { tooOld, unchecked };
}

function sweepCopiesWithoutMinToolkit(root) {
  const toolkitRoot = require('./toolkit-cloud-workflows.cjs').sourceRoot();
  return oldSweepCopies(root, toolkitRoot, (commit, git) => {
    const shown = git(['show', `${commit}:${STATE_SCRIPT}`]);
    return shown.status === 0 && shown.stdout.includes("'min_toolkit'");
  });
}

// The binding reader and its retired keys, loaded on first use.
const programmeState = () => require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { SEMVER, compareVersions, isToolkitSourceCheckout } = require('./toolkit-version.cjs');

// Why the pinned sweep copies hold the cleanup, naming the too old and the unchecked ones apart.
function heldBy({ tooOld = [], unchecked = [] }) {
  if (!tooOld.length && !unchecked.length) return null;
  const parts = [];
  if (tooOld.length) parts.push(`the pinned Toolkit copies ${tooOld.join(', ')} run a Toolkit that does not know min_toolkit, so after the cleanup they would read the programme file as invalid and the programme board would stop updating`);
  if (unchecked.length) parts.push(`the pinned Toolkit copies ${unchecked.join(', ')} could not be checked, because this Toolkit copy cannot read the commit they are pinned to (it is not a Toolkit git checkout, or does not have that commit yet), so they might read the cleaned programme file as invalid`);
  return { held: parts.join('; '), step: tooOld.length ? 'Refresh them first' : 'Run this from a Toolkit git checkout that has their commit, or refresh them first' };
}

// The programme file with min_toolkit set, in its own layout (indent, line endings, byte order mark),
// so the pull request shows one added or changed line; a layout it cannot follow is written out whole.
// A retired key (programme-state.cjs) goes in the same change, as one removed line.
function withMinToolkit(original, binding) {
  const text = programmeState().withoutRetiredKeysText(original);
  const expected = { ...programmeState().withoutRetiredKeys(binding), min_toolkit: MIN_TOOLKIT };
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = text.slice(bom.length);
  const same = candidate => { try { return JSON.stringify(JSON.parse(candidate)) === JSON.stringify(JSON.parse(JSON.stringify(expected))); } catch { return false; } };
  let edited;
  if (Object.hasOwn(binding, 'min_toolkit')) edited = body.replace(/("min_toolkit"\s*:\s*)"[^"]*"/, `$1"${MIN_TOOLKIT}"`);
  else {
    const close = body.lastIndexOf('}');
    const head = body.slice(0, close).replace(/\s+$/, '');
    const newline = body.includes('\r\n') ? '\r\n' : '\n';
    const indent = /\n([ \t]+)"/.exec(head)?.[1];
    edited = indent === undefined ? `${head}, "min_toolkit": "${MIN_TOOLKIT}"${body.slice(head.length)}` : `${head},${newline}${indent}"min_toolkit": "${MIN_TOOLKIT}"${body.slice(head.length)}`;
  }
  return same(edited) ? `${bom}${edited}` : `${JSON.stringify(expected, null, 2)}\n`;
}

// { ok, changes: [{ file, action }], lines }, plus { held, step, files } when the pinned sweep copies hold it
// and { refused, files } when the programme file stops it after the scan, so the bank can say why.
// `governance` and `sweepReaders` (root => { tooOld, unchecked } sweep copies) are for tests.
function run({ root, write = false, governance = null, sweepReaders = sweepCopiesWithoutMinToolkit }) {
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: false, changes: [], lines: [`Nothing was changed: ${root} is not the top folder of a git checkout.`] };
  // A Toolkit source checkout builds its own instruction files from the templates, so its copies are
  // cleaned by hand there, never by this command.
  if (isToolkitSourceCheckout(root)) {
    return { ok: false, changes: [], lines: ['Nothing was changed: this is a Toolkit source checkout, which builds its own instruction files from the templates, so its copies are removed by hand in a source pull request.'] };
  }
  const scan = new LeftoverScan({ discover: () => [], ...(governance ? { governance } : {}) }).inspect(root);
  if (!scan.scanned) return { ok: false, changes: [], lines: [`Nothing was changed: ${scan.reason}.`] };
  if (!scan.governed) return { ok: false, changes: [], lines: [`Nothing was changed: governance is not on here (${scan.governance}). Use the leftover scan's report; removing Toolkit files from a repository without governance is the owner's choice.`] };

  const changes = [];
  const byFile = new Map();
  for (const item of scan.files) (byFile.get(item.file) || byFile.set(item.file, []).get(item.file)).push(item);
  for (const [file, items] of byFile) {
    // An older marked CLAUDE.md shim that loads the repository's own AGENTS.md becomes the one line,
    // as a repository-agent-rules refresh does; the file's other listed blocks go in the same run, and
    // the rest of the file stays.
    const shim = items.find(item => item.kind === 'shim-block');
    if (shim) {
      let text = fs.readFileSync(path.join(root, file), 'utf8');
      for (const item of items.filter(entry => entry !== shim)) text = blocks.removeBlock(text, item.block);
      const block = blocks.findBlocks(text).blocks.find(entry => entry.name === shim.block);
      const others = items.filter(entry => entry !== shim).map(entry => entry.block);
      changes.push({ file, action: 'replace-shim', text: text.slice(0, block.start) + SHIM_LINE + text.slice(block.end), edited: items.some(item => item.edited), ...(others.length ? { others } : {}) });
      continue;
    }
    if (items[0].kind !== 'block' || items[0].empties) { changes.push({ file, action: 'delete' }); continue; }
    let text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const item of items) text = blocks.removeBlock(text, item.block);
    text = withoutCuratedHeader(text);
    changes.push({ file, action: 'remove-block', text, edited: items.some(item => item.edited) });
  }

  let binding, bindingText = '';
  try { bindingText = fs.readFileSync(path.join(root, BINDING_FILE), 'utf8'); binding = JSON.parse(bindingText.replace(/^\uFEFF/, '')); } catch { binding = null; }
  const refuse = refused => ({ ok: false, refused, files: changes.length, changes: [], lines: [`Nothing was changed: ${refused}.`] });
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return refuse(`${BINDING_FILE} could not be read, so min_toolkit cannot be set. Fix it first`);
  }
  // min_toolkit is a version 2 key: a version 1 binding holding it would read as invalid once merged.
  if (binding.schema !== 'toolkit.programme-binding.v2') {
    return refuse(`${BINDING_FILE} is not a version 2 programme file, and only version 2 can carry min_toolkit. Move it to version 2 first`);
  }
  // A value that is not a version is replaced, as an older one is raised.
  if (typeof binding.min_toolkit !== 'string' || !SEMVER.test(binding.min_toolkit) || compareVersions(MIN_TOOLKIT, binding.min_toolkit) > 0) {
    const hold = heldBy(sweepReaders(root));
    if (hold) {
      return { ok: false, held: hold.held, step: hold.step, files: changes.length, changes: [], lines: [`Nothing was changed: ${hold.held}. ${hold.step} (toolkit-cloud-workflows.cjs --repo <repository>, one pull request the owner merges), then clean up.`] };
    }
    const retired = programmeState().RETIRED_BINDING_KEYS.filter(key => Object.hasOwn(binding, key));
    changes.push({ file: BINDING_FILE, action: 'set-min-toolkit', text: withMinToolkit(bindingText, binding), retired });
  }

  const words = { delete: 'remove the file', 'remove-block': 'remove the Toolkit block, keeping the rest of the file',
    'replace-shim': `replace the old Toolkit shim block with the line ${SHIM_LINE}, keeping the rest of the file`, 'set-min-toolkit': `set min_toolkit to ${MIN_TOOLKIT}` };
  const lines = [changes.length ? `${write ? 'Changed' : 'Would change'} in ${scan.name}:` : `Nothing to clean in ${scan.name}.`,
    ...changes.map(change => `- ${change.file}: ${words[change.action]}${change.others?.length ? `, and remove the Toolkit ${change.others.join(' and ')} ${change.others.length === 1 ? 'block' : 'blocks'}` : ''}${change.retired?.length ? `, and delete the retired ${change.retired.join(' and ')}, which nothing reads any more` : ''}${change.edited ? ' (the block was edited by hand since Toolkit wrote it, and those edits go with it)' : ''}.`),
    ...scan.unproven.map(item => `- Left in place: ${item.file}, because ${item.reason}.`)];
  if (write) {
    for (const change of changes) {
      const file = path.join(root, change.file);
      if (change.action === 'delete') fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, change.text);
    }
  }
  if (changes.length) lines.push(write
    ? 'Next: commit these on a new branch and open one pull request for the owner to merge. It deletes files, so it never goes through task auto-merge.'
    : 'Run again with --write to make these changes in the working tree.');
  // Every app that works here reads min_toolkit once this merges, and an older copy holds governance.
  if (write && changes.some(change => change.action === 'set-min-toolkit')) {
    lines.push(`Before merging, update Toolkit on every app that works in this repository (setup toolkit), so each copy is ${MIN_TOOLKIT} or later. A copy that then reads the programme file as unusable needs updating; never remove min_toolkit to quiet it.`);
  }
  return { ok: true, changes: changes.map(({ file, action }) => ({ file, action })), lines };
}

function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  let root = process.cwd(), write = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--write') write = true;
    else if (argv[index] === '--repo' && argv[index + 1]) root = path.resolve(argv[++index]);
    else { error(USAGE); return 2; }
  }
  const result = run({ root, write });
  for (const line of result.lines) log(line);
  return result.ok ? 0 : 1;
}

module.exports = Object.freeze({ MIN_TOOLKIT, run, main });

if (require.main === module) process.exitCode = main();
