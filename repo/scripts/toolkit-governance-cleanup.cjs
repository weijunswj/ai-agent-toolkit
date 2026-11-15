#!/usr/bin/env node
'use strict';

// The cleanup route for a repository whose governance is on. The installed Toolkit gives its sessions
// the governed rules and the playbooks, so the copies older setups wrote are leftovers. This removes
// exactly what the leftover scan (toolkit-leftover-files.cjs) proves is Toolkit's, in the working tree:
//   - a governed-rules block in AGENTS.md, or the Antigravity bootstrap block, keeping every byte
//     outside the markers; a file left with nothing of the owner's is deleted;
//   - a one-line CLAUDE.md, only when AGENTS.md has nothing of its own left;
//   - docs/agent-playbooks/ files that are a copy Toolkit shipped, now or earlier.
// It also sets `min_toolkit` in the programme file, so a Toolkit copy too old to deliver the rules
// says to update instead of running without them. The checks and workflow copies governance uses,
// and anything not proven Toolkit's, stay. It never runs git: the changes go to the owner in one pull
// request per repository, which the owner merges (never task auto-merge, because it deletes files).
//
// Usage: node repo/scripts/toolkit-governance-cleanup.cjs [--repo <folder>] [--write]
// Without --write it only shows what would change.

const fs = require('node:fs');
const path = require('node:path');
const blocks = require('./toolkit-managed-block.cjs');
const { LeftoverScan } = require('./toolkit-leftover-files.cjs');

// The first release whose installed Toolkit gives sessions the governed rules. A copy that knows the
// key and is older says to update; a copy older than the key reads the binding as ERROR, which also
// holds governance effects while ordinary work continues.
const MIN_TOOLKIT = '3.127.0';
const BINDING_FILE = '.github/toolkit-programme.json';
const USAGE = 'Usage: node repo/scripts/toolkit-governance-cleanup.cjs [--repo <folder>] [--write]';

// A Toolkit source checkout builds its own instruction files from the templates, so its copies are
// cleaned by hand there, never by this command.
const SOURCE_MARKERS = Object.freeze(['skills/repository-agent-rules/repo-local/AGENTS.managed.template.md', 'repo/scripts/sync-agent-instruction-shims.cjs']);

const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// { ok, changes: [{ file, action, text? }], lines }. `governance` is for tests.
// The programme file with min_toolkit set, in its own layout (indent, line endings, byte order mark),
// so the pull request shows one added or changed line; a layout it cannot follow is written out whole.
function withMinToolkit(text, binding) {
  const expected = { ...binding, min_toolkit: MIN_TOOLKIT };
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

function run({ root, write = false, governance = null }) {
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: false, changes: [], lines: [`Nothing was changed: ${root} is not the top folder of a git checkout.`] };
  if (SOURCE_MARKERS.every(file => fs.existsSync(path.join(root, ...file.split('/'))))) {
    return { ok: false, changes: [], lines: ['Nothing was changed: this is a Toolkit source checkout, which builds its own instruction files from the templates, so its copies are removed by hand in a source pull request.'] };
  }
  const scan = new LeftoverScan({ discover: () => [], ...(governance ? { governance } : {}) }).inspect(root);
  if (!scan.scanned) return { ok: false, changes: [], lines: [`Nothing was changed: ${scan.reason}.`] };
  if (!scan.governed) return { ok: false, changes: [], lines: [`Nothing was changed: governance is not on here (${scan.governance}). Use the leftover scan's report; removing Toolkit files from a repository without governance is the owner's choice.`] };

  const changes = [];
  const byFile = new Map();
  for (const item of scan.files) (byFile.get(item.file) || byFile.set(item.file, []).get(item.file)).push(item);
  for (const [file, items] of byFile) {
    if (items[0].kind !== 'block' || items[0].empties) { changes.push({ file, action: 'delete' }); continue; }
    let text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const item of items) text = blocks.removeBlock(text, item.block);
    changes.push({ file, action: 'remove-block', text });
  }

  let binding, bindingText = '';
  try { bindingText = fs.readFileSync(path.join(root, BINDING_FILE), 'utf8'); binding = JSON.parse(bindingText.replace(/^\uFEFF/, '')); } catch { binding = null; }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { ok: false, changes: [], lines: [`Nothing was changed: ${BINDING_FILE} could not be read, so min_toolkit cannot be set. Fix it first.`] };
  }
  // min_toolkit is a version 2 key: a version 1 binding holding it would read as invalid once merged.
  if (binding.schema !== 'toolkit.programme-binding.v2') {
    return { ok: false, changes: [], lines: [`Nothing was changed: ${BINDING_FILE} is not a version 2 programme file, and only version 2 can carry min_toolkit. Move it to version 2 first.`] };
  }
  if (typeof binding.min_toolkit !== 'string' || newer(MIN_TOOLKIT, binding.min_toolkit)) {
    changes.push({ file: BINDING_FILE, action: 'set-min-toolkit', text: withMinToolkit(bindingText, binding) });
  }

  const words = { delete: 'remove the file', 'remove-block': 'remove the Toolkit block, keeping the rest of the file', 'set-min-toolkit': `set min_toolkit to ${MIN_TOOLKIT}` };
  const lines = [changes.length ? `${write ? 'Changed' : 'Would change'} in ${scan.name}:` : `Nothing to clean in ${scan.name}.`,
    ...changes.map(change => `- ${change.file}: ${words[change.action]}.`),
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
