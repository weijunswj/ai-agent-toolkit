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
  let fence = null, comment = false, details = 0, managed = null, html = false;
  let start = null, content = null, end = source.length, areaClosed = false;
  const cuts = [];
  for (const match of lines) {
    const raw = match[0], line = raw.replace(/(?:\r\n|[\r\n])$/, ''), at = match.index;
    if (start !== null && !areaClosed && /^<!-- AI-AGENT-TOOLKIT:[^\n]*:BEGIN /.test(line)) {
      if (fence) return unsafe('open_fence');
      if (comment) return unsafe('open_comment');
      if (details) return unsafe('unbalanced_details');
      end = at; areaClosed = true;
    }
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
      continue;
    }
    if (!comment && /^<!-- AI-AGENT-TOOLKIT:[^\n]*:BEGIN /.test(line)) { managed = true; continue; }
    if (managed) {
      if (/^<!-- AI-AGENT-TOOLKIT:[^\n]*:END /.test(line)) managed = null;
      continue;
    }
    const open = line.lastIndexOf('<!--'), close = line.lastIndexOf('-->');
    if (comment) {
      if (open >= 0 || close >= 0) comment = open > close;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (opening) {
      if (opening[1][0] === '`' && opening[2].includes('`')) {
        // Invalid fence info can change how subsequent headings render. Refuse this subset.
        if (start !== null && !areaClosed || source.slice(at).includes('## Archive')) return unsafe('invalid_fence');
      }
      fence = { char: opening[1][0], length: opening[1].length }; continue;
    }
    // Raw HTML blocks have context-dependent Markdown rules. Do not archive through them.
    if (!/^ {0,3}<!--/.test(line) && (/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i.test(line)
      || /^ {0,3}<(?:[!?]|[a-z][a-z0-9-]*(?:[ \t][^\n]*)?\/?[ \t]*>)/i.test(line) && !/^ {0,3}<\/?details\b/i.test(line))) {
      if (start !== null && !areaClosed) return unsafe('raw_html');
      html = true;
    }
    // The last delimiter on the line owns comment state, after fence and HTML starts.
    if (open >= 0) { comment = open > close; continue; }
    for (const tag of line.matchAll(/<\/?details\b[^>]*>/gi)) {
      details += /^<\//.test(tag[0]) ? -1 : 1;
      if (details < 0 && start !== null && !areaClosed) return unsafe('unbalanced_details');
    }
    if (line === '## Archive') {
      if (details) continue;
      if (start !== null) return unsafe('duplicate_marker');
      if (html) return unsafe('raw_html');
      start = at; content = at + raw.length;
    } else if (start !== null && !areaClosed) {
      if (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(line)) {
        if (details) return unsafe('unbalanced_details');
        end = at; areaClosed = true;
      } else if (/^### [^\r\n]+$/.test(line) && !details) cuts.push(at);
    }
  }
  if (start === null) return { items: [], start: null, end: null };
  if (!areaClosed && fence) return unsafe('open_fence');
  if (!areaClosed && comment) return unsafe('open_comment');
  if (!areaClosed && details) return unsafe('unbalanced_details');
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
