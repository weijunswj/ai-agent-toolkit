'use strict';

// Pure archive grammar and comment formatting. The reconciler owns all state and effects.
const crypto = require('node:crypto');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const COMMENT_LIMIT = 60000;
const GROUPS = ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'];
const marker = key => `<!-- programme-page-archive key=${key} -->`;
const unsafe = reason => ({ unsafe: reason, items: [] });

// Accept only the stated Markdown subset. Offsets always refer to the original bytes/code units.
function archiveSection(source) {
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)].filter(match => match[0]);
  let fence = null, managed = null, previousBlank = true, previousText = false;
  let start = null, content = null, end = source.length, areaClosed = false, failure = null;
  const cuts = [];
  // This is an accept-list, not an HTML/CommonMark renderer. Scan the whole body before
  // moving anything, including text before the marker. Code and managed contents are inert.
  for (const match of lines) {
    const raw = match[0], line = raw.replace(/(?:\r\n|[\r\n])$/, ''), at = match.index;
    if (fence) {
      if (/^<!-- AI-AGENT-TOOLKIT:[^\n]*:BEGIN /.test(line)) failure ||= 'open_fence';
      if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
      previousBlank = false; previousText = false;
      continue;
    }
    if (managed) {
      if (line === managed) managed = null;
      previousBlank = false; previousText = false;
      continue;
    }
    const begin = /^<!-- AI-AGENT-TOOLKIT:([^\r\n]+):BEGIN ([A-Z][A-Z0-9_-]*) v2 toolkit=[0-9]+\.[0-9]+\.[0-9]+ sha256=[a-f0-9]{12} -->$/.exec(line);
    if (begin) {
      if (start !== null && !areaClosed) { end = at; areaClosed = true; }
      managed = `<!-- AI-AGENT-TOOLKIT:${begin[1]}:END ${begin[2]} -->`;
      previousBlank = false; previousText = false;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (opening) {
      if (opening[1][0] === '`' && opening[2].includes('`')) failure ||= 'invalid_fence';
      fence = { char: opening[1][0], length: opening[1].length };
      previousBlank = false; previousText = false;
      continue;
    }
    if (/^ {0,3}</.test(line) || line.includes('<!--') || /<\/?[a-z][a-z0-9-]*(?=[\s/>]|$)/i.test(line)) failure ||= 'raw_html';
    if (previousText && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) failure ||= 'unsupported_markup';
    if (/^## Archive *$/.exec(line)?.[0] === line) {
      if (start !== null) return unsafe('duplicate_marker');
      if (!previousBlank) failure ||= 'unsupported_markup';
      start = at; content = at + raw.length;
    } else if (start !== null && !areaClosed) {
      if (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(line)) { end = at; areaClosed = true; }
      else if (/^### [^\r\n]+$/.test(line)) cuts.push(at);
    }
    previousBlank = /^[ \t]*$/.test(line);
    previousText = !previousBlank && !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
  }
  if (start === null) return { items: [], start: null, end: null };
  if (failure) return unsafe(failure);
  if (fence) return unsafe('open_fence');
  if (managed) return unsafe('unsupported_markup');
  const boundaries = [content, ...cuts.filter(at => at > content), end];
  const definitions = [...source.matchAll(/^ {0,3}\[([^\]\r\n]+)\]:[^\r\n]*(?:(?:\r\n|[\r\n])[ \t]+[^\r\n]*)*(?:\r\n|[\r\n]|$)/gm)];
  const items = [];
  const occurrences = new Map();
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1], text = source.slice(from, boundaries[i]);
    if (!text.trim()) continue;
    const title = /^### (.+)\r?$/m.exec(text)?.[1] || 'Archived notes';
    const ordinal = (occurrences.get(title) || 0) + 1; occurrences.set(title, ordinal);
    const key = `section-${digest(`${title}|${ordinal}`).slice(0, 16)}`;
    const normalizeLabel = label => label.replace(/\s+/g, ' ').trim().toLowerCase();
    const used = new Set([...text.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)].map(match => normalizeLabel(match[2] || match[1])));
    const refs = definitions.filter(match => used.has(normalizeLabel(match[1]))).map(match => match[0]).join('');
    // Split oversized items only at blank lines, without changing a single source character.
    const paragraphs = text.match(/[^]*?(?:(?:\r\n|[\r\n])[ \t]*(?:\r\n|[\r\n])|$)/g).filter(Boolean);
    let chunk = '', offset = from, part = 1;
    const emit = () => {
      if (!chunk) return;
      items.push({ key: `${key}-${part++}`, kind: 'section', group: null, title, start: offset, end: offset + chunk.length, text: chunk, refs });
      offset += chunk.length; chunk = '';
    };
    for (const paragraph of paragraphs) {
      if (sectionComment({ key: `${key}-${part}`, text: chunk + paragraph, refs }).length >= COMMENT_LIMIT) emit();
      if (sectionComment({ key: `${key}-${part}`, text: paragraph, refs }).length >= COMMENT_LIMIT) return unsafe('item_too_large');
      chunk += paragraph;
    }
    emit();
  }
  return { start, content, end, items };
}

function sectionComment(item) {
  return `${marker(item.key)}\nMoved unchanged from the programme page.\n\n${item.text}${item.refs ? `\nReference links (originals remain on the page):\n${item.refs}` : ''}`;
}

function graphComments(rows) {
  const parts = [];
  for (const group of GROUPS) {
    let lines = [], part = 1;
    const text = list => `${marker(`graph-${group.toLowerCase()}-${part}`)}\n# Programme graph: ${group}\n\n${list.length ? '| Task | Task Description | Child # | PR # | Class | Status | Last updated (SGT) |\n|---|---|---|---|---|---|---|\n' + list.join('\n') : 'No rows are archived in this part.'}\n`;
    const emit = () => { parts.push({ key: `graph-${group.toLowerCase()}-${part}`, kind: 'graph', group, title: group, body: text(lines), count: lines.length }); part++; lines = []; };
    for (const row of rows.filter(row => row.group === group)) {
      if (text([...lines, row.text]).length >= COMMENT_LIMIT) emit();
      if (text([row.text]).length >= COMMENT_LIMIT) throw new Error('A graph row exceeds the archive comment limit.');
      lines.push(row.text);
    }
    if (lines.length) emit();
  }
  return parts;
}

function removeItems(source, area, items) {
  let result = source;
  for (const item of [...items].sort((a, b) => b.start - a.start)) {
    const definitions = item.text.match(/^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*(?:(?:\r\n|[\r\n])[ \t]+[^\r\n]*)*(?:\r\n|[\r\n]|$)/gm) || [];
    result = result.slice(0, item.start) + definitions.join('') + result.slice(item.end);
  }
  if (area.start !== null && items.length === area.items.length) {
    // Preserve all whitespace outside the marked area's own line and contents.
    result = result.slice(0, area.start) + result.slice(area.content);
  }
  return result;
}

module.exports = { GROUPS, digest, marker, archiveSection, sectionComment, graphComments, removeItems };
