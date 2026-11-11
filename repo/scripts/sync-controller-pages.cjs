#!/usr/bin/env node
'use strict';

// repo/CONTROLLER.md is a small core; the rest of the controller rules live in the pages under
// repo/controller/. The core's Pages section lists every page with a short hash of its content,
// so a change to a page also changes the core file, and every "compare the CONTROLLER.md blob"
// binding keeps seeing the whole rule set through that one file.
//
// --write refreshes the hashes. The default (--check) reports, without writing:
//   - a listed page that is missing, or a file under repo/controller/ that is not listed;
//   - a hash in the core that no longer matches its page;
//   - a page without its title and its pointer back to the core;
//   - a rule line that has two homes;
//   - a relative link in the core or a page that points at nothing.
//
// Usage: node repo/scripts/sync-controller-pages.cjs [--write] [--root <dir>]

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CORE = 'repo/CONTROLLER.md';
const PAGES_DIR = 'repo/controller';
const HEADING = '## Pages';
const BACK_POINTER = 'Part of the [Toolkit Controller](../CONTROLLER.md); it binds like that file.';
const ENTRY = /^- \[([^\]]+)\]\(controller\/([a-z0-9-]+\.md)\) `([0-9a-f]{12})`: \S.*$/;

const normalise = text => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
const read = (root, rel) => normalise(fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'));
const pageHash = text => crypto.createHash('sha256').update(normalise(text)).digest('hex').slice(0, 12);

// The Pages section runs from its heading to the next heading of the same level, or the file end.
function pagesSection(core) {
  const lines = core.split('\n');
  const starts = lines.reduce((found, line, index) => (line === HEADING ? [...found, index] : found), []);
  if (starts.length !== 1) return { error: `${CORE} needs exactly one "${HEADING}" section (found ${starts.length})` };
  const start = starts[0];
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  return { lines, start, end };
}

function listedPages(core) {
  const section = pagesSection(core);
  if (section.error) return { errors: [section.error], entries: [] };
  const errors = [];
  const entries = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const line = section.lines[index];
    if (!line.startsWith('- ')) continue;
    const match = ENTRY.exec(line);
    if (!match) {
      errors.push(`${CORE} line ${index + 1}: a Pages entry must read "- [Title](controller/<name>.md) \`<12 hex>\`: <when to read it>"`);
      continue;
    }
    if (entries.some(entry => entry.file === match[2])) errors.push(`${CORE} lists controller/${match[2]} twice`);
    entries.push({ index, title: match[1], file: match[2], hash: match[3] });
  }
  if (!entries.length && !errors.length) errors.push(`${CORE} lists no pages under "${HEADING}"`);
  return { errors, entries, section };
}

function relativeLinks(text) {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1])
    .filter(target => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#'));
}

function inspect(root) {
  const errors = [];
  let core;
  try { core = read(root, CORE); } catch { return { errors: [`Missing ${CORE}`], entries: [], core: '' }; }
  const { errors: listErrors, entries } = listedPages(core);
  errors.push(...listErrors);

  const dir = path.join(root, ...PAGES_DIR.split('/'));
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const listed = new Set(entries.map(entry => entry.file));
  for (const name of onDisk) if (!listed.has(name)) errors.push(`${PAGES_DIR}/${name} is not listed under "${HEADING}" in ${CORE}`);

  const texts = new Map([[CORE, core]]);
  for (const entry of entries) {
    const rel = `${PAGES_DIR}/${entry.file}`;
    if (!onDisk.includes(entry.file)) { errors.push(`${CORE} lists ${rel}, which does not exist`); continue; }
    const text = read(root, rel);
    texts.set(rel, text);
    entry.actual = pageHash(text);
    if (entry.actual !== entry.hash) errors.push(`${rel} changed: its hash in ${CORE} is ${entry.hash}, its content is ${entry.actual} (run with --write)`);
    const [title, pointer] = text.split('\n');
    if (!/^# \S/.test(title || '') || pointer !== BACK_POINTER) errors.push(`${rel} must start with a "# " title, then the line: ${BACK_POINTER}`);
  }

  // One home per rule: apart from the pointer every page carries, no line may sit in two places.
  const homes = new Map();
  for (const [rel, text] of texts) {
    text.split('\n').forEach((line, index) => {
      if (!line.trim() || line === BACK_POINTER) return;
      const seen = homes.get(line);
      if (seen) errors.push(`${rel} line ${index + 1} repeats ${seen}: each rule has one home`);
      else homes.set(line, `${rel} line ${index + 1}`);
    });
  }

  for (const [rel, text] of texts) {
    for (const target of relativeLinks(text)) {
      const file = path.join(root, ...path.posix.join(path.posix.dirname(rel), target.split('#')[0]).split('/'));
      if (!fs.existsSync(file)) errors.push(`${rel} links to ${target}, which does not exist`);
    }
  }
  return { errors, entries, core };
}

function check(root) {
  return inspect(root).errors;
}

// Rewrites only the hash of each listed page; every other error still has to be fixed by hand.
function write(root) {
  const { entries, core } = inspect(root);
  const lines = core.split('\n');
  let changed = 0;
  for (const entry of entries) {
    if (!entry.actual || entry.actual === entry.hash) continue;
    lines[entry.index] = lines[entry.index].replace(`\`${entry.hash}\``, `\`${entry.actual}\``);
    changed += 1;
  }
  if (changed) fs.writeFileSync(path.join(root, ...CORE.split('/')), lines.join('\n'));
  return { changed, errors: check(root) };
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = path.resolve(rootFlag === -1 ? process.cwd() : argv[rootFlag + 1] || '');
  const result = argv.includes('--write') ? write(root) : { changed: 0, errors: check(root) };
  if (result.changed) console.log(`Updated ${result.changed} page hash(es) in ${CORE}.`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    return 1;
  }
  console.log('Controller pages are in step with the core.');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { BACK_POINTER, CORE, PAGES_DIR, check, listedPages, pageHash, write };
