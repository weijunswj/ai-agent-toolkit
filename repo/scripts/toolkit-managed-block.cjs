'use strict';

// The marker pair around every Toolkit insert in an instruction file, and the only edits
// Toolkit makes to such a file. Format v2:
//
//   <!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->
//   ...body...
//   <!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->
//
// `sha256` is the first 12 hex digits of the SHA-256 of the body (LF line endings, no trailing
// blank lines), so an edit inside the block is detectable. Bytes outside the markers, including
// line endings, are never changed. Format v1 BEGIN lines (`... v1 -->`, no version or digest)
// still parse so a refresh can replace them by name.

const crypto = require('node:crypto');

const FORMAT = 2;
const BEGIN = /^<!-- AI-AGENT-TOOLKIT:(\S+):BEGIN (\S+) v(\d+)(?: toolkit=(\d+\.\d+\.\d+) sha256=([0-9a-f]{12}))? -->$/;
const END = /^<!-- AI-AGENT-TOOLKIT:(\S+):END (\S+) -->$/;
const ANY_MARKER = /^\s*<!--\s*AI-AGENT-TOOLKIT:/;

function normalizeBody(body) {
  return String(body).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function bodyDigest(body) {
  return crypto.createHash('sha256').update(normalizeBody(body)).digest('hex').slice(0, 12);
}

function beginLine({ source, name, version, body }) {
  return `<!-- AI-AGENT-TOOLKIT:${source}:BEGIN ${name} v${FORMAT} toolkit=${version} sha256=${bodyDigest(body)} -->`;
}

function endLine({ source, name }) {
  return `<!-- AI-AGENT-TOOLKIT:${source}:END ${name} -->`;
}

// The block as LF text without a trailing newline.
function renderBlock(block) {
  return [beginLine(block), normalizeBody(block.body), endLine(block)].join('\n');
}

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

// Every complete block with its character offsets, plus structural errors. A block's `end`
// offset is just past its END line, before that line's line ending.
function findBlocks(text) {
  const blocks = [];
  const errors = [];
  const lines = [];
  for (let offset = 0; offset <= text.length;) {
    const next = text.indexOf('\n', offset);
    const stop = next === -1 ? text.length : next;
    const content = text.slice(offset, stop).replace(/\r$/, '');
    lines.push({ start: offset, end: offset + content.length, content });
    if (next === -1) break;
    offset = next + 1;
  }
  let open = null;
  lines.forEach((line, index) => {
    if (!ANY_MARKER.test(line.content)) return;
    const begin = BEGIN.exec(line.content);
    const end = END.exec(line.content);
    if (begin) {
      if (open) errors.push(`line ${index + 1}: BEGIN ${begin[2]} inside ${open.name}`);
      open = { source: begin[1], name: begin[2], format: Number(begin[3]), version: begin[4] || null,
        digest: begin[5] || null, start: line.start, bodyStart: index + 1 };
      return;
    }
    if (end) {
      if (!open) { errors.push(`line ${index + 1}: END ${end[2]} without BEGIN`); return; }
      if (open.source !== end[1] || open.name !== end[2]) {
        errors.push(`line ${index + 1}: END ${end[2]} does not match BEGIN ${open.name}`);
        open = null;
        return;
      }
      const body = lines.slice(open.bodyStart, index).map(entry => entry.content).join('\n');
      if (blocks.some(block => block.name === open.name)) errors.push(`line ${index + 1}: duplicate block ${open.name}`);
      blocks.push({ ...open, body, end: line.end });
      open = null;
      return;
    }
    errors.push(`line ${index + 1}: malformed AI-AGENT-TOOLKIT marker`);
  });
  if (open) errors.push(`BEGIN ${open.name} without END`);
  return { blocks, errors };
}

// current: identical to the expected block. tampered: the body no longer matches its own
// digest (edited by hand). stale: an older version, an older format or a different body.
function blockState(found, expected) {
  if (!found) return 'absent';
  if (found.format >= 2 && found.digest !== bodyDigest(found.body)) return 'tampered';
  if (found.format === FORMAT && found.source === expected.source && found.version === expected.version
    && normalizeBody(found.body) === normalizeBody(expected.body)) return 'current';
  return 'stale';
}

// Replaces the blocks named in `replaces` (the first one found keeps its place) with the
// expected block, or inserts it at the top or bottom. Uses the file's own line ending.
function upsertBlock(text, expected, { replaces = [expected.name], position = 'top' } = {}) {
  const eol = eolOf(text);
  const rendered = renderBlock(expected).split('\n').join(eol);
  const { blocks, errors } = findBlocks(text);
  if (errors.length) throw Object.assign(new Error(`Toolkit markers are broken: ${errors[0]}`), { code: 'MANAGED_BLOCK_BROKEN' });
  const targets = blocks.filter(block => replaces.includes(block.name));
  if (!targets.length) {
    if (!text) return `${rendered}${eol}`;
    if (position === 'top') return `${rendered}${eol}${eol}${text}`;
    // The existing text is kept as it is (including its trailing newlines, or none), so removing
    // the block later gives back exactly the same bytes.
    return `${text}${eol}${rendered}${eol}`;
  }
  let result = text;
  for (const block of [...targets].reverse()) {
    const replacement = block === targets[0] ? rendered : '';
    result = replacement ? result.slice(0, block.start) + replacement + result.slice(block.end)
      : removeRange(result, block.start, block.end);
  }
  return result;
}

// Removes a block and the separator insertion added: a block at the end of the file takes the one
// line ending before it, any other block one blank line after it.
function removeRange(text, start, end) {
  let before = text.slice(0, start);
  let after = text.slice(end).replace(/^\r?\n/, '');
  if (/^\r?\n/.test(after)) after = after.replace(/^\r?\n/, '');
  else if (!after) before = before.replace(/\r?\n$/, '');
  return before + after;
}

function removeBlock(text, name) {
  const { blocks, errors } = findBlocks(text);
  if (errors.length) throw Object.assign(new Error(`Toolkit markers are broken: ${errors[0]}`), { code: 'MANAGED_BLOCK_BROKEN' });
  const block = blocks.find(entry => entry.name === name);
  return block ? removeRange(text, block.start, block.end) : text;
}

module.exports = Object.freeze({ FORMAT, bodyDigest, beginLine, endLine, renderBlock, findBlocks, blockState, upsertBlock, removeBlock, normalizeBody });
