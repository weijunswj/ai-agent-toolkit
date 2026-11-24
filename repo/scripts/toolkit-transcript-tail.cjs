'use strict';

// Reads the end of a Claude Code session transcript (one JSON entry per line) for the hooks that
// need what the session did last: the model and effort it served on (the gate route check,
// toolkit-gate-route.cjs, and the agent hook's cost check) and whether a skill was loaded since
// the chat's context was last compacted (the agent hook). The transcript format is internal to
// Claude Code and changes between versions, so every reader here returns "not known" rather than
// a guess when an entry does not look as expected. Loads only node:fs and never writes.

const fs = require('node:fs');
const { readSlice } = require('./toolkit-transcript-head.cjs');

const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const parse = line => { try { return JSON.parse(line); } catch { return null; } };

// { entries, complete } from the last `maxBytes` of `file`: the parsed entries, oldest first, and
// whether the slice reached the start of the file. null when the file cannot be read.
function readTail(file, maxBytes) {
  if (typeof file !== 'string' || !file) return null;
  let size;
  try { size = fs.statSync(file).size; } catch { return null; }
  const start = Math.max(0, size - maxBytes);
  let text;
  try { text = readSlice(file, start, size - start); } catch { return null; }
  const lines = text.split('\n');
  // A slice that starts mid-file starts mid-line; that partial line is never read.
  if (start > 0) lines.shift();
  return { entries: lines.map(parse).filter(entry => entry && typeof entry === 'object'), complete: start === 0 };
}

// { model, effort } the CLI wrote on the newest main-thread assistant entry; missing parts are null.
function servedRoute(entries) {
  for (let index = (entries || []).length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'assistant' || entry.isSidechain) continue;
    const model = entry.message && entry.message.model;
    if (typeof model !== 'string' || !model || model.startsWith('<')) continue;
    return { model, effort: EFFORTS.includes(entry.effort) ? entry.effort : null };
  }
  return { model: null, effort: null };
}

// The skill names a main-thread entry loads: a Skill tool call's `skill`, or a typed
// `/<skill>` command.
function loadedSkills(entry) {
  if (entry.isSidechain) return [];
  const content = entry.message && entry.message.content;
  if (entry.type === 'assistant' && Array.isArray(content)) {
    return content.filter(part => part && part.type === 'tool_use' && part.name === 'Skill' && part.input && typeof part.input.skill === 'string')
      .map(part => part.input.skill.trim().replace(/^\//, ''));
  }
  if (entry.type !== 'user') return [];
  const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(part => part && part.type === 'text').map(part => String(part.text)) : [];
  return texts.flatMap(text => [...text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)].map(match => match[1]));
}

const isCompaction = entry => entry.type === 'system' && entry.subtype === 'compact_boundary';

// Whether `skill` (bare, or as `<plugin>:<skill>`) was loaded on the main thread after the last
// compaction boundary. A slice that did not reach the start of the file and found neither counts
// as not loaded.
function skillLoadedSinceCompaction(tail, skill) {
  if (!tail) return false;
  const wanted = name => name === skill || name.endsWith(`:${skill}`);
  for (let index = tail.entries.length - 1; index >= 0; index -= 1) {
    const entry = tail.entries[index];
    if (isCompaction(entry)) return false;
    if (loadedSkills(entry).some(wanted)) return true;
  }
  return false;
}

module.exports = Object.freeze({ EFFORTS, readTail, servedRoute, skillLoadedSinceCompaction });
