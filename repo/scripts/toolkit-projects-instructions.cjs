#!/usr/bin/env node
'use strict';

// Read-only renderer/checker. The coordinator applies the block itself, with a saved copy of the
// previous instructions, a check of the result and a note with an undo (Projects skill sync).
//
//   --render                    the managed block
//   --check <file> [--declined <version>] [--declined-dedupe <version>]
//                               current | outdated | edited | missing | misplaced | declined | malformed,
//                               then `overlaps: <n> (...)` when project lines repeat block lines
//   --place <file>              the instructions with main's block at the top and every project
//                               line kept, in order
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { renderBlock, findBlocks, blockState, removeBlock, normalizeBody, bodyDigest } = require('./toolkit-managed-block.cjs');

const SOURCE_FILE = 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md';
const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const SOURCE = 'claude-projects';
const NAME = 'PROJECT-INSTRUCTIONS';
const VERSION = /^\d+\.\d+\.\d+$/;
// How far back the source's history is searched for the block an edited marker was written from.
const HISTORY_COMMITS = 100;
const KEPT_LABEL = '(kept from an edit inside the block)';
// Trimmed lines carry this label and are never flagged again.
const ADDS_LABEL = /\(adds to the block/i;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'its', 'are', 'any', 'all', 'not',
  'only', 'each', 'when', 'then', 'than', 'but', 'also', 'own', 'one', 'out', 'has', 'have', 'was', 'were', 'will', 'can', 'may']);
// Flag when most words match (a near copy), or when many words match (a long line that restates
// a block line among its own text). Tuned on real project lines: it misses repeats worded
// differently, so the coordinator still reads the lines on every block change.
const OVERLAP_SHARE = 0.6;
const OVERLAP_MIN_WORDS = 4;
const OVERLAP_MANY_WORDS = 8;
const OVERLAP_MANY_SHARE = 0.4;

function target(text) {
  const { blocks, errors } = findBlocks(text);
  const targets = blocks.filter(block => block.name === NAME);
  if (errors.length || targets.length > 1 || (targets[0] && targets[0].source !== SOURCE)) return { malformed: true };
  return { found: targets[0] };
}

function checkInstructions(text, expected, declinedVersion) {
  const { malformed, found } = target(text);
  if (malformed) return { state: 'malformed', exitCode: 2 };
  let state = { absent: 'missing', tampered: 'edited', stale: 'outdated', current: 'current' }[blockState(found, expected)];
  if (state === 'outdated' && declinedVersion === expected.version) return { state: 'declined', exitCode: 0 };
  // The block goes first: only blank lines may come before it.
  if (state === 'current' && text.slice(0, found.start).trim()) state = 'misplaced';
  return { state, exitCode: state === 'current' ? 0 : 1 };
}

function words(line) {
  return new Set((line.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length >= 3 && !STOP_WORDS.has(word)));
}

// A cheap hint, not a judgement: project lines (outside the markers) sharing most of their words
// with a line of the current block, either way round. File line numbers for the project line,
// body line numbers for the block line.
function findOverlaps(text, expected) {
  const { found } = target(text);
  const blockLines = normalizeBody(expected.body).split('\n').map((line, index) => ({ index: index + 1, words: words(line) }))
    .filter(line => line.words.size >= OVERLAP_MIN_WORDS);
  const insideBlock = offset => found && offset >= found.start && offset <= found.end;
  const overlaps = [];
  let offset = 0;
  text.split('\n').forEach((raw, index) => {
    const start = offset;
    offset += raw.length + 1;
    const line = raw.replace(/\r$/, '');
    if (insideBlock(start) || !line.trim() || ADDS_LABEL.test(line)) return;
    const own = words(line);
    if (own.size < OVERLAP_MIN_WORDS) return;
    let best = null;
    for (const block of blockLines) {
      const shared = [...own].filter(word => block.words.has(word)).length;
      const share = Math.max(shared / own.size, shared / block.words.size);
      const near = shared >= OVERLAP_MIN_WORDS && share >= OVERLAP_SHARE;
      const many = shared >= OVERLAP_MANY_WORDS && share >= OVERLAP_MANY_SHARE;
      if ((near || many) && (!best || share > best.share)) best = { block: block.index, share };
    }
    if (best) overlaps.push({ line: index + 1, block: best.block });
  });
  return overlaps;
}

function overlapsLine(overlaps) {
  return `overlaps: ${overlaps.length} (${overlaps.map(entry => `line ${entry.line} ~ block line ${entry.block}`).join('; ')})`;
}

// Main's block first, then every project line in its original order. Lines someone added or changed
// inside an edited block move just below it under a label, so no project text is lost. They are
// found against the block the marker was written from (`baseBody`, looked up by the marker's digest)
// so lines of an older block version are not kept as edits; without it, against main's block.
function placeInstructions(text, expected, { baseBody = null } = {}) {
  const { malformed, found } = target(text);
  if (malformed) throw Object.assign(new Error('PROJECT_INSTRUCTIONS_MALFORMED'), { code: 'MALFORMED' });
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const rendered = renderBlock(expected).split('\n').join(eol);
  const kept = [];
  if (found && blockState(found, expected) === 'tampered') {
    const base = new Set(normalizeBody(baseBody === null ? expected.body : baseBody).split('\n').map(line => line.trim()));
    for (const line of normalizeBody(found.body).split('\n')) if (line.trim() && !base.has(line.trim())) kept.push(line);
  }
  const rest = (found ? removeBlock(text, NAME) : text).replace(/^(?:[ \t]*\r?\n)+/, '');
  const parts = [rendered];
  if (kept.length) parts.push([KEPT_LABEL, ...kept].join(eol));
  if (rest.trim()) parts.push(rest.replace(/(?:\r?\n)+$/, ''));
  return `${parts.join(`${eol}${eol}`)}${eol}`;
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--render') return { mode: 'render' };
  if (args.length === 2 && args[0] === '--place' && !args[1].startsWith('--')) return { mode: 'place', file: args[1] };
  if (args[0] === '--check' && args[1] && !args[1].startsWith('--')) {
    const options = { mode: 'check', file: args[1] };
    const flags = { '--declined': 'declinedVersion', '--declined-dedupe': 'declinedDedupe' };
    for (let index = 2; index < args.length; index += 2) {
      const key = flags[args[index]];
      if (!key || options[key] !== undefined || !VERSION.test(args[index + 1] || '')) throw new Error('PROJECT_INSTRUCTIONS_ARGUMENTS');
      options[key] = args[index + 1];
    }
    return options;
  }
  throw new Error('PROJECT_INSTRUCTIONS_ARGUMENTS');
}

// The body of the source file at the most recent commit whose body has this digest, or null (no git,
// a shallow history, or no match).
function gitBodyForDigest(root, digest) {
  const git = args => childProcess.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  try {
    for (const commit of git(['log', '--format=%H', '-n', String(HISTORY_COMMITS), '--', SOURCE_FILE]).split('\n').filter(Boolean)) {
      const body = git(['show', `${commit}:${SOURCE_FILE}`]);
      if (bodyDigest(body) === digest) return body;
    }
  } catch { return null; }
  return null;
}

class ProjectsInstructions {
  // `bodyForDigest(digest)` finds an earlier block body by its marker digest (tests pass their own).
  constructor({ root = path.resolve(__dirname, '../..'), readFile = fs.readFileSync, bodyForDigest = digest => gitBodyForDigest(root, digest) } = {}) {
    this.root = root;
    this.readFile = readFile;
    this.bodyForDigest = bodyForDigest;
  }

  expectedBlock() {
    const body = this.readFile(path.join(this.root, SOURCE_FILE), 'utf8');
    const { version } = JSON.parse(this.readFile(path.join(this.root, VERSION_FILE), 'utf8'));
    const parsed = findBlocks(body);
    if (!VERSION.test(version) || !body.trim() || parsed.blocks.length || parsed.errors.length) {
      throw new Error('PROJECT_INSTRUCTIONS_SOURCE');
    }
    return { source: SOURCE, name: NAME, version, body };
  }

  render() {
    return renderBlock(this.expectedBlock());
  }

  check(file, declinedVersion, declinedDedupe) {
    const expected = this.expectedBlock();
    const text = this.readFile(file, 'utf8');
    const result = checkInstructions(text, expected, declinedVersion);
    if (result.state === 'malformed' || declinedDedupe === expected.version) return { ...result, overlaps: [] };
    const overlaps = findOverlaps(text, expected);
    return { ...result, overlaps, exitCode: overlaps.length && !result.exitCode ? 1 : result.exitCode };
  }

  place(file) {
    const text = this.readFile(file, 'utf8');
    const expected = this.expectedBlock();
    const { found } = target(text);
    const edited = found && found.digest && blockState(found, expected) === 'tampered';
    return placeInstructions(text, expected, { baseBody: edited ? this.bodyForDigest(found.digest) : null });
  }
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const instructions = new ProjectsInstructions();
    if (options.mode === 'render') {
      process.stdout.write(`${instructions.render()}\n`);
      return 0;
    }
    if (options.mode === 'place') {
      process.stdout.write(instructions.place(options.file));
      return 0;
    }
    const result = instructions.check(options.file, options.declinedVersion, options.declinedDedupe);
    process.stdout.write(`${result.state}\n${result.overlaps.length ? `${overlapsLine(result.overlaps)}\n` : ''}`);
    return result.exitCode;
  } catch {
    process.stderr.write('Project instructions could not be processed (PROJECT_INSTRUCTIONS_INVALID).\n');
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ ProjectsInstructions, checkInstructions, findOverlaps, placeInstructions, parseArgs });
