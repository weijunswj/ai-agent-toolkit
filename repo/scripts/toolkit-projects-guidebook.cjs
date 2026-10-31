#!/usr/bin/env node
'use strict';

// Keeps the Projects coordinator's guidebook: a copy of the web-controller-projects skill in the
// project library, which the coordinator reads every turn (its runtime loads no account skills).
//
//   --out <folder>     copy the skill tree, write instructions-block.md (main's managed block with
//                      its real marker), then write VERSION last and read every file back. Prints
//                      `SKILL COPY REFRESHED <Version>`, plus `BLOCK CHANGED <toolkit version>` when
//                      the block differs from the copy it replaced.
//   --check <folder>   `current <Version>`, `stale <reason>` or `missing <reason>`; exit 0 only
//                      when current. Read-only.
//
// VERSION is one line: `Version: <skill Version> toolkit <x.y.z> main <commit7> copied <UTC>`.
// It is removed first and written last, so a copy cut short never looks current. Files a newer
// skill dropped, and folders left empty, are removed from the folder, which only this script writes.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectsInstructions } = require('./toolkit-projects-instructions.cjs');

const SKILL_DIR = 'repo/contracts/claude-projects/web-controller-projects';
const BLOCK_FILE = 'instructions-block.md';
const VERSION_FILE = 'VERSION';
const SKILL_VERSION = /^Version: (\d{4}-\d{2}-\d{2}\.\d+)$/m;
const BLOCK_MARKER = /^<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN PROJECT-INSTRUCTIONS v2 toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->\n/;
const VERSION_LINE =/^Version: (\d{4}-\d{2}-\d{2}\.\d+) toolkit (\d+\.\d+\.\d+) main ([0-9a-f]{7}) copied (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\n?$/;

class GuidebookError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new GuidebookError('GUIDEBOOK_LINK');
    if (entry.isDirectory()) return listFiles(full, base);
    return [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

// Folders a skill change emptied (the folder itself stays). Bottom-up, so nested empty folders go too.
function removeEmptyDirs(dir, top = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), top);
  }
  if (dir !== top && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

function gitCommit(root) {
  try {
    return childProcess.execFileSync('git', ['-C', root, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { throw new GuidebookError('GUIDEBOOK_COMMIT'); }
}

class Guidebook {
  constructor({ root = path.resolve(__dirname, '../..'), commit = () => gitCommit(root), now = () => new Date() } = {}) {
    this.root = root;
    this.commit = commit;
    this.now = now;
  }

  // What main's copy holds: every skill file, the rendered block and the expected Version fields.
  expected() {
    const dir = path.join(this.root, SKILL_DIR);
    const files = new Map(listFiles(dir).map(rel => [rel, fs.readFileSync(path.join(dir, rel))]));
    const match = SKILL_VERSION.exec((files.get('SKILL.md') || '').toString('utf8'));
    if (!match || files.has(BLOCK_FILE) || files.has(VERSION_FILE)) throw new GuidebookError('GUIDEBOOK_SOURCE');
    const instructions = new ProjectsInstructions({ root: this.root });
    const block = `${instructions.render()}\n`;
    return { files, block, version: match[1], toolkit: instructions.expectedBlock().version };
  }

  check(out) {
    const expected = this.expected();
    const versionPath = path.join(out, VERSION_FILE);
    if (!fs.existsSync(versionPath)) return { state: 'missing', reason: fs.existsSync(out) ? 'no VERSION' : 'no folder' };
    const found = VERSION_LINE.exec(fs.readFileSync(versionPath, 'utf8'));
    if (!found) return { state: 'stale', reason: 'VERSION unreadable' };
    if (found[1] !== expected.version) return { state: 'stale', reason: `skill ${found[1]}, main ${expected.version}` };
    if (found[2] !== expected.toolkit) return { state: 'stale', reason: `toolkit ${found[2]}, main ${expected.toolkit}` };
    const wanted = new Map(expected.files);
    wanted.set(BLOCK_FILE, Buffer.from(expected.block, 'utf8'));
    const differs = [...wanted].filter(([rel, bytes]) => {
      const file = path.join(out, rel);
      return !fs.existsSync(file) || !fs.readFileSync(file).equals(bytes);
    }).map(([rel]) => rel);
    if (differs.length) return { state: 'stale', reason: `differs ${differs.join(', ')}` };
    return { state: 'current', version: expected.version };
  }

  #written(out, present) {
    const read = rel => (present.includes(rel) ? fs.readFileSync(path.join(out, rel), 'utf8') : '');
    return VERSION_LINE.test(read(VERSION_FILE)) || BLOCK_MARKER.test(read(BLOCK_FILE));
  }

  refresh(out) {
    const expected = this.expected();
    const exists = fs.existsSync(out);
    if (exists && !fs.statSync(out).isDirectory()) throw new GuidebookError('GUIDEBOOK_OUT');
    const present = exists ? listFiles(out) : [];
    // Never take over a folder this script did not write: it holds a VERSION in this script's exact
    // format, or a block file that starts with the real marker (a refresh cut short after removing
    // VERSION, or a damaged VERSION). A file merely named VERSION is not enough.
    if (present.length && !this.#written(out, present)) throw new GuidebookError('GUIDEBOOK_FOREIGN');
    const blockPath = path.join(out, BLOCK_FILE);
    const oldBlock = fs.existsSync(blockPath) ? fs.readFileSync(blockPath, 'utf8') : null;
    const commit = this.commit();
    if (!/^[0-9a-f]{7}$/.test(commit)) throw new GuidebookError('GUIDEBOOK_COMMIT');

    fs.rmSync(path.join(out, VERSION_FILE), { force: true });
    const writes = new Map(expected.files);
    writes.set(BLOCK_FILE, Buffer.from(expected.block, 'utf8'));
    for (const rel of present) {
      if (rel !== VERSION_FILE && !writes.has(rel)) fs.rmSync(path.join(out, rel));
    }
    if (exists) removeEmptyDirs(out);
    for (const [rel, bytes] of writes) {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.writeFileSync(path.join(out, rel), bytes);
    }
    for (const [rel, bytes] of writes) {
      if (!fs.readFileSync(path.join(out, rel)).equals(bytes)) throw new GuidebookError('GUIDEBOOK_READBACK');
    }
    const copied = this.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const line = `Version: ${expected.version} toolkit ${expected.toolkit} main ${commit} copied ${copied}\n`;
    fs.writeFileSync(path.join(out, VERSION_FILE), line);
    if (fs.readFileSync(path.join(out, VERSION_FILE), 'utf8') !== line) throw new GuidebookError('GUIDEBOOK_READBACK');
    return { version: expected.version, toolkit: expected.toolkit, blockChanged: oldBlock !== expected.block };
  }
}

function parseArgs(args) {
  if (args.length === 2 && ['--out', '--check'].includes(args[0]) && args[1] && !args[1].startsWith('--')) {
    return { mode: args[0].slice(2), folder: path.resolve(args[1]) };
  }
  throw new GuidebookError('GUIDEBOOK_ARGUMENTS');
}

function main(args = process.argv.slice(2), guidebook = new Guidebook()) {
  try {
    const options = parseArgs(args);
    if (options.mode === 'check') {
      const result = guidebook.check(options.folder);
      process.stdout.write(result.state === 'current' ? `current ${result.version}\n` : `${result.state} ${result.reason}\n`);
      return result.state === 'current' ? 0 : 1;
    }
    const result = guidebook.refresh(options.folder);
    process.stdout.write(`SKILL COPY REFRESHED ${result.version}\n${result.blockChanged ? `BLOCK CHANGED ${result.toolkit}\n` : ''}`);
    return 0;
  } catch (error) {
    const code = error instanceof GuidebookError ? error.code : 'GUIDEBOOK_INVALID';
    process.stderr.write(`SKILL COPY FAILED ${code}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ Guidebook, GuidebookError, parseArgs, main, VERSION_LINE });
