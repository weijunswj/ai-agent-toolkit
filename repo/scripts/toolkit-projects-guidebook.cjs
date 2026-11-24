#!/usr/bin/env node
'use strict';

// Keeps the Projects coordinator's guidebook: a copy of the web-controller-projects skill in the
// project library, which the coordinator reads every turn (its runtime loads no account skills).
//
//   --out <folder>     copy the skill tree, write instructions-block.md (main's managed block with
//                      its real marker), then write VERSION last and read every file back. Prints
//                      `SKILL COPY REFRESHED <Version>`, plus `BLOCK CHANGED <toolkit version>` when
//                      the block's text differs from the copy it replaced (a marker version or digest
//                      alone is no change, so an identical block is never re-applied).
//   --check <folder>   `current <Version>`, `stale <reason>` or `missing <reason>`; exit 0 only
//                      when current. Read-only.
//   --refresh <folder> the hourly run's every-run mode. It first proves this checkout is origin's
//                      main tip (`SKILL COPY FAILED STALE_CHECKOUT <head7>, main <tip7>` otherwise, and
//                      nothing is written), then prints `GUIDEBOOK CURRENT <Version> toolkit <x.y.z>,
//                      main <commit7>` or refreshes and prints `GUIDEBOOK REFRESHED <old> -> <new>,
//                      main <commit7>` (each side `<Version> toolkit <x.y.z>`, or `none`), any
//                      `BLOCK CHANGED`, and checks the result.
//   --card [--synced <folder>]
//                      after the same proof, one line on the owner's saved claude.ai copy of the skill
//                      (`toolkit-projects-skill-card.cjs`); `--synced` defaults to Claude Code's synced
//                      skills folder.
//
// Both refresh and check refuse takeover-named or identical playbook copies anywhere in the skill tree.
// VERSION is one line: `Version: <skill Version> toolkit <x.y.z> main <commit7> copied <UTC>`.
// BASE names the local Toolkit files the Projects controller inherits (its base), one
// `<git blob SHA> <path>` line each, so the weekly base clash check can tell which base this copy
// follows. The SHA is git's blob id of the file with CRLF read as LF, so it needs no git.
// It is removed first and written last, so a copy cut short never looks current. Files a newer
// skill dropped, and folders left empty, are removed from the folder, which only this script writes.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectsInstructions } = require('./toolkit-projects-instructions.cjs');
const { findBlocks, sameText } = require('./toolkit-managed-block.cjs');
const { skillCard, cardLine, defaultSyncedDir } = require('./toolkit-projects-skill-card.cjs');

const SKILL_DIR = 'repo/contracts/claude-projects/web-controller-projects';
const TAKEOVER_SOURCE = 'repo/docs/agent-playbooks/controller-takeover.md';
const TAKEOVER_FILE = 'takeover.md';
const BLOCK_FILE = 'instructions-block.md';
const BASE_FILE = 'BASE';
// The base the Projects controller follows as written: its rule layers, the controller file and its
// pages, and the hook manifest whose cloud cover reference/cloud-hook-parity.md records.
const BASE_PATHS = Object.freeze([
  'repo/contracts/agent-rules/global-rules.md',
  'repo/contracts/agent-rules/gate-rules.md',
  'repo/contracts/agent-rules/toolkit-governed-rules.md',
  'repo/CONTROLLER.md',
  'repo/controller/principles.md',
  'repo/controller/roles-and-routes.md',
  'repo/controller/gates.md',
  'repo/controller/evidence-and-finish.md',
  '.claude-plugin/hooks/hooks.json',
]);
const VERSION_FILE = 'VERSION';
const SKILL_VERSION = /^Version: (\d{4}-\d{2}-\d{2}\.\d+)$/m;
const BLOCK_MARKER = /^<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN PROJECT-INSTRUCTIONS v2 toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->\n/;
const VERSION_LINE =/^Version: (\d{4}-\d{2}-\d{2}\.\d+) toolkit (\d+\.\d+\.\d+) main ([0-9a-f]{7}) copied (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\n?$/;

// git's blob id for a text file, CRLF read as LF.
function blobSha(bytes) {
  const text = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1').update(`blob ${text.length}\0`).update(text).digest('hex');
}

function baseText(root) {
  return BASE_PATHS.map(rel => {
    let bytes;
    try { bytes = fs.readFileSync(path.join(root, rel)); } catch { throw new GuidebookError('GUIDEBOOK_SOURCE'); }
    return `${blobSha(bytes)} ${rel}\n`;
  }).join('');
}

class GuidebookError extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; }
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

// This checkout's HEAD and origin's main tip, both full SHAs ('' when unreadable). A clone left from an
// earlier run reads its own old main as current, so the every-run modes compare the two first.
function gitTip(root) {
  const git = args => childProcess.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 60000 }).trim();
  let head = '';
  let main = '';
  try { head = git(['rev-parse', 'HEAD']); } catch { /* reported below */ }
  try { main = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0]; } catch { /* reported below */ }
  return { head, main };
}

function isTakeoverCopy(rel, bytes, canonical) {
  return /takeover.*\.md$/i.test(path.basename(rel))
    || bytes.toString('utf8').replace(/\r\n/g, '\n') === canonical.toString('utf8').replace(/\r\n/g, '\n');
}

class Guidebook {
  constructor({ root = path.resolve(__dirname, '../..'), commit = () => gitCommit(root), now = () => new Date(), tip = () => gitTip(root) } = {}) {
    this.root = root;
    this.commit = commit;
    this.now = now;
    this.tip = tip;
  }

  // Refuses a checkout that is not origin's main tip, or whose tip cannot be read.
  #proveTip() {
    const { head, main } = this.tip();
    const sha = /^[0-9a-f]{40}$/;
    if (!sha.test(head) || !sha.test(main) || head !== main) {
      throw new GuidebookError('STALE_CHECKOUT', `${sha.test(head) ? head.slice(0, 7) : 'unknown'}, main ${sha.test(main) ? main.slice(0, 7) : 'unknown'}`);
    }
  }

  // The hourly every-run refresh: current, or refreshed from <old> to <new>, then checked.
  refreshReport(out) {
    this.#proveTip();
    const before = this.check(out);
    const expected = this.expected();
    const commit = this.commit();
    const side = (version, toolkit) => `${version} toolkit ${toolkit}`;
    if (before.state === 'current') return { state: 'current', now: side(expected.version, expected.toolkit), commit };
    let old = 'none';
    try {
      const found = VERSION_LINE.exec(fs.readFileSync(path.join(out, VERSION_FILE), 'utf8'));
      if (found) old = side(found[1], found[2]);
    } catch { /* no earlier VERSION: none */ }
    const result = this.refresh(out);
    const after = this.check(out);
    if (after.state !== 'current') throw new GuidebookError('GUIDEBOOK_READBACK', `${after.state} ${after.reason}`);
    return { state: 'refreshed', old, now: side(result.version, result.toolkit), commit, blockChanged: result.blockChanged, toolkit: result.toolkit };
  }

  // The owner's saved claude.ai copy of this skill against main's SKILL.md text.
  card(syncedDir) {
    this.#proveTip();
    return skillCard(syncedDir, fs.readFileSync(path.join(this.root, SKILL_DIR, 'SKILL.md'), 'utf8'));
  }

  // What main's copy holds: every skill file, the rendered block and the expected Version fields.
  expected() {
    const takeover = fs.readFileSync(path.join(this.root, TAKEOVER_SOURCE));
    const dir = path.join(this.root, SKILL_DIR);
    const files = new Map(listFiles(dir).map(rel => [rel, fs.readFileSync(path.join(dir, rel))]));
    const match = SKILL_VERSION.exec((files.get('SKILL.md') || '').toString('utf8'));
    if (!match || files.has(BLOCK_FILE) || files.has(VERSION_FILE) || files.has(BASE_FILE) || [...files].some(([rel, bytes]) => isTakeoverCopy(rel, bytes, takeover))) throw new GuidebookError('GUIDEBOOK_SOURCE');
    files.set(TAKEOVER_FILE, takeover);
    files.set(BASE_FILE, Buffer.from(baseText(this.root), 'utf8'));
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
    return { version: expected.version, toolkit: expected.toolkit, blockChanged: blockTextChanged(oldBlock, expected) };
  }
}

// Whether the block file a refresh replaced held other text than main's block. Its marker's Toolkit
// version and digest are not text: a release that moves only them asks for no change.
function blockTextChanged(oldBlock, expected) {
  if (oldBlock === null) return true;
  const parsed = findBlocks(oldBlock);
  const [mainBlock] = findBlocks(expected.block).blocks;
  return !mainBlock || parsed.errors.length > 0 || parsed.blocks.length !== 1 || !sameText(parsed.blocks[0], mainBlock);
}

function parseArgs(args) {
  if (args.length === 2 && ['--out', '--check', '--refresh'].includes(args[0]) && args[1] && !args[1].startsWith('--')) {
    return { mode: args[0].slice(2), folder: path.resolve(args[1]) };
  }
  if (args[0] === '--card' && (args.length === 1 || (args.length === 3 && args[1] === '--synced' && args[2] && !args[2].startsWith('--')))) {
    return { mode: 'card', synced: args.length === 3 ? path.resolve(args[2]) : defaultSyncedDir() };
  }
  throw new GuidebookError('GUIDEBOOK_ARGUMENTS');
}

function main(args = process.argv.slice(2), guidebook = new Guidebook()) {
  let mode = null;
  try {
    const options = parseArgs(args);
    mode = options.mode;
    if (mode === 'check') {
      const result = guidebook.check(options.folder);
      process.stdout.write(result.state === 'current' ? `current ${result.version}\n` : `${result.state} ${result.reason}\n`);
      return result.state === 'current' ? 0 : 1;
    }
    if (mode === 'card') {
      process.stdout.write(`${cardLine(guidebook.card(options.synced))}\n`);
      return 0;
    }
    if (mode === 'refresh') {
      const result = guidebook.refreshReport(options.folder);
      process.stdout.write(result.state === 'current' ? `GUIDEBOOK CURRENT ${result.now}, main ${result.commit}\n`
        : `GUIDEBOOK REFRESHED ${result.old} -> ${result.now}, main ${result.commit}\n${result.blockChanged ? `BLOCK CHANGED ${result.toolkit}\n` : ''}`);
      return 0;
    }
    const result = guidebook.refresh(options.folder);
    process.stdout.write(`SKILL COPY REFRESHED ${result.version}\n${result.blockChanged ? `BLOCK CHANGED ${result.toolkit}\n` : ''}`);
    return 0;
  } catch (error) {
    const known = error instanceof GuidebookError;
    const code = known ? error.code : 'GUIDEBOOK_INVALID';
    const detail = known && error.detail ? ` ${error.detail}` : '';
    process.stderr.write(`${mode === 'card' ? 'SKILL CARD FAILED' : 'SKILL COPY FAILED'} ${code}${detail}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ Guidebook, GuidebookError, parseArgs, main, VERSION_LINE, BASE_PATHS, blobSha });
