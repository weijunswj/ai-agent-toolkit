'use strict';

// Pure archive comment formatting and the marked-notes reader. The reconciler owns all state and effects.
const crypto = require('node:crypto');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const COMMENT_LIMIT = 60000;
const GROUPS = ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'];
const marker = key => `<!-- programme-page-archive key=${key} -->`;
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

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Marked notes (pure). The owner puts old hand-written notes under one `## Archive` line. This
// reader finds where that area ends and where it may be split; what is inside stays opaque.
//
// It is default-deny. From the top of the page to the end of the area, outside generated blocks,
// every line must be one of a few kinds that GitHub's Markdown and its HTML parser read the same
// way: a blank line, a top-level heading, a fence at column 0 and the code inside it, a fold line
// (`<details>`, `<summary>`, `</details>`) at column 0, an HTML comment opened at column 0 that ends
// where both parsers end it, or a text line with no HTML-like text, no heading or fence behind a
// container, and no unusual space. Any other line moves nothing.
const NOTE_MARKER_LINE = '## Archive';
const NOTE_KEY = /^note-[0-9a-f]{12}-[1-9][0-9]*$/;
const NOTE_REASONS = ['two_markers', 'marker_nested', 'open_fence', 'open_comment', 'open_html', 'ambiguous_markup',
  'underlined_heading', 'control_character', 'link_definition_split', 'part_too_large', 'secret_like', 'comment_not_exact'];
const MANAGED_SHAPE = /<!--\s*AI-AGENT-TOOLKIT:/;
const MANAGED_LINE = /^<!-- AI-AGENT-TOOLKIT:([^\s:]+):(BEGIN|END) (\S+)/;
const DEFINITION = /^ {0,3}\[([^\]\n]+)\]:[ \t]*\S/;
const BLANK = /^[ \t]*$/;
const TOP_HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const TOP_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const FOLD_OPEN = /^<details(?:[ \t][^<>`]*)?>(?:[ \t]*<summary>[^<>`]*<\/summary>)?[ \t]*$/i;
const FOLD_SUMMARY = /^<summary>[^<>`]*<\/summary>[ \t]*$/i;
const FOLD_CLOSE = /^<\/details>[ \t]*$/i;
// HTML-like text: `<` then a letter, `/`, `!` or `?`. Only plain autolinks are let through: each
// `<` is checked where it stands, and the line is never rewritten.
const HTML_START = /<[A-Za-z/!?]/g;
const AUTOLINK_AT = /<(?:https?|mailto):[^\s<>]*>/iy;
function htmlLike(line) {
  HTML_START.lastIndex = 0;
  for (let found = HTML_START.exec(line); found; found = HTML_START.exec(line)) {
    AUTOLINK_AT.lastIndex = found.index;
    if (!AUTOLINK_AT.test(line)) return true;
    HTML_START.lastIndex = AUTOLINK_AT.lastIndex;
  }
  return false;
}
// Spaces GitHub does not treat as blank, and breaks it may read as line ends.
const ODD_SPACE = /[   -   　﻿\u000B\u000C\u0085]/;
// Where a heading or fence could start behind indentation, block quote markers, list markers or a
// footnote label, found in one left-to-right scan.
const LIST_MARKER = /(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/y;
const FOOTNOTE_LABEL = /\[\^[^\]\s]+\]:/y;
const ATX_AT = /#{1,2}(?:[ \t]|$)/y;
const UNDERLINE_AT = /(?:=+|-+)[ \t]*$/y;
const ANY_ATX_AT = /#{1,6}(?:[ \t]|$)/y;
const FENCE_AT = /(?:`{3}|~{3})/y;
function containerStops(line) {
  const stops = [0];
  for (let at = 0; at < line.length;) {
    let next = at;
    while (next < line.length && (line[next] === ' ' || line[next] === '\t')) next += 1;
    if (next === at && line[at] === '>') next = at + 1;
    if (next === at) { LIST_MARKER.lastIndex = at; if (LIST_MARKER.test(line)) next = LIST_MARKER.lastIndex; }
    if (next === at) { FOOTNOTE_LABEL.lastIndex = at; if (FOOTNOTE_LABEL.test(line)) next = FOOTNOTE_LABEL.lastIndex; }
    if (next === at) break;
    stops.push(next);
    at = next;
  }
  return stops;
}
const matchesAt = (pattern, line, at) => { pattern.lastIndex = at; return pattern.test(line); };
const contentOf = line => line.slice(containerStops(line).at(-1));
// A comment opened at column 0 that ends on the same line, where both parsers end it: the only
// `-->` is at the end and there is no `--!>` (the HTML parser also ends a comment there).
// Trailing spaces and tabs cut in one pass (a `[ \t]+$` search is quadratic on a long blank run).
function trimBlankEnd(line) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  return line.slice(0, end);
}
function oneLineComment(line) {
  const text = trimBlankEnd(line);
  return /^<!--(?!-?>)/.test(text) && text.length >= 7 && text.endsWith('-->') && !text.slice(4, -3).includes('-->') && !text.includes('--!>');
}
const commentOpen = line => /^<!--(?!-?>)/.test(line) && !line.slice(4).includes('-->') && !line.includes('--!>');

function sourceLines(text) {
  const lines = [];
  for (let offset = 0; offset < text.length;) {
    const next = text.indexOf('\n', offset);
    const end = next === -1 ? text.length : next + 1;
    lines.push({ start: offset, end, text: text.slice(offset, next === -1 ? text.length : next).replace(/\r$/, '') });
    offset = end;
  }
  return lines;
}

const label = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
function usedLabels(lines) {
  const used = new Set();
  for (const line of lines) {
    const definition = DEFINITION.exec(line.text);
    const text = definition ? line.text.slice(line.text.indexOf(']:') + 2) : line.text;
    for (const match of text.matchAll(/\[([^[\]\n]+)\]/g)) used.add(label(match[1]));
  }
  return used;
}

function noteComment(id, part, total, text, definitions) {
  return [marker(`note-${id}-${part}`), `# Archived notes: part ${part} of ${total}`, '',
    'Moved unchanged from the programme page. The text between the two marker lines below is exact. Do not edit or delete this comment: Toolkit checks it and reports any change.', '',
    `<!-- programme-note-begin sha256=${digest(text)} -->`, text, '<!-- programme-note-end -->',
    ...(definitions.length ? ['', '<!-- programme-note-links -->', ...definitions] : [])].join('\n');
}

// The exact note text a note comment carries, or null when the comment is not an intact note.
function noteText(body) {
  const text = String(body || '');
  const begin = /^<!-- programme-page-archive key=note-[0-9a-f]{12}-[1-9][0-9]* -->\n# Archived notes: part [1-9][0-9]* of [1-9][0-9]*\n\n[^\n]*\n\n<!-- programme-note-begin sha256=([0-9a-f]{64}) -->\n/.exec(text);
  const end = text.lastIndexOf('\n<!-- programme-note-end -->');
  if (!begin || end < begin[0].length - 1) return null;
  const payload = text.slice(begin[0].length, end);
  return digest(payload) === begin[1] ? payload : null;
}

// { kind: 'none' } | { kind: 'unsafe', reason } | { kind: 'area', start, end, id, parts }.
// The parts' texts joined are exactly body.slice(start, end), the marker line included.
// { kind: 'none' } | { kind: 'unsafe', reason } | { kind: 'area', start, end, id, parts }.
// The parts' texts joined are exactly body.slice(start, end), the marker line included.
function noteArea(body, { limit = COMMENT_LIMIT } = {}) {
  const text = String(body || '');
  const lines = sourceLines(text);
  // `fence` is the open code block; `comment` an open multi-line comment; `depth` the open folds;
  // `html` is true from a fold line to the next blank line (GitHub's HTML block).
  let fence = null, comment = false, depth = 0, html = false, managed = null, previous = null, afterFoldOpen = false;
  let markers = 0, nested = false, start = -1, end = -1, reason = null;
  const seams = [];
  const fail = why => { reason ||= why; };
  const neutral = () => !fence && !comment && depth === 0 && !html;
  const close = at => {
    if (fence) fail('open_fence');
    else if (comment) fail('open_comment');
    else if (depth) fail('open_html');
    end = at;
  };
  for (const line of lines) {
    const open = start !== -1 && end === -1;
    const reading = end === -1;
    const raw = line.text;
    if (managed) {
      if (raw === NOTE_MARKER_LINE) { markers += 1; nested = true; }
      const block = MANAGED_LINE.exec(raw);
      if (block && block[2] === 'END' && block[1] === managed.source && block[3] === managed.name) managed = null;
      // A generated block is trusted only while nothing in it can run past its END line: up to the
      // area end, each line in it is blank, a one-line comment or a text line with no HTML-like text,
      // no fence and no other marker shape.
      else if (reading && ODD_SPACE.test(raw)) fail('control_character');
      else if (reading && (MANAGED_SHAPE.test(raw) || !BLANK.test(raw) && !oneLineComment(raw)
        && (htmlLike(raw) || containerStops(raw).some(at => matchesAt(FENCE_AT, raw, at))))) fail('ambiguous_markup');
      previous = null;
      continue;
    }
    if (reading && ODD_SPACE.test(raw)) fail('control_character');
    if (fence) {
      const shut = FENCE_CLOSE.exec(raw);
      if (shut && shut[1][0] === fence.character && shut[1].length >= fence.length) fence = null;
      else if (raw === NOTE_MARKER_LINE) { markers += 1; nested = true; }
      else if (reading && MANAGED_SHAPE.test(raw)) fail('ambiguous_markup');
      previous = raw;
      continue;
    }
    if (comment) {
      if (raw === NOTE_MARKER_LINE) { markers += 1; nested = true; }
      const trimmed = trimBlankEnd(raw);
      if (raw.includes('--!>') || raw.includes('-->') && !(trimmed.endsWith('-->') && !trimmed.slice(0, -3).includes('-->'))) { if (reading) fail('ambiguous_markup'); }
      if (raw.includes('-->')) comment = false;
      else if (reading && MANAGED_SHAPE.test(raw)) fail('ambiguous_markup');
      previous = raw;
      continue;
    }
    const block = MANAGED_LINE.exec(raw);
    if (block) {
      if (block[2] === 'BEGIN' && neutral()) {
        if (open) close(line.start);
        managed = { source: block[1], name: block[3] };
      } else if (reading) fail('ambiguous_markup');
      previous = null;
      continue;
    }
    if (reading && MANAGED_SHAPE.test(raw)) fail('ambiguous_markup');
    const wasFoldOpen = afterFoldOpen;
    afterFoldOpen = false;
    if (BLANK.test(raw)) {
      html = false;
      previous = raw;
      continue;
    }
    const plain = neutral();
    // A part may start at a line after a blank line, or at a level three to six heading.
    const afterBlank = open && plain && previous !== null && BLANK.test(previous);
    // Inside a GitHub HTML block only fold lines and one-line comments are read.
    const foldLine = FOLD_OPEN.test(raw) || FOLD_CLOSE.test(raw) || wasFoldOpen && FOLD_SUMMARY.test(raw);
    if (html && !foldLine && !oneLineComment(raw)) {
      if (raw === NOTE_MARKER_LINE) { markers += 1; nested = true; }
      if (reading) fail('ambiguous_markup');
      previous = raw;
      continue;
    }
    if (raw === NOTE_MARKER_LINE) {
      markers += 1;
      if (!plain) nested = true;
      else if (start === -1) start = line.start;
      previous = raw;
      continue;
    }
    if (foldLine) {
      if (afterBlank) seams.push({ at: line.start, heading: false });
      if (FOLD_OPEN.test(raw)) { depth += 1; afterFoldOpen = true; }
      else if (FOLD_CLOSE.test(raw)) { if (depth === 0) { if (reading) fail('open_html'); } else depth -= 1; }
      html = true;
      previous = raw;
      continue;
    }
    if (oneLineComment(raw)) {
      if (afterBlank) seams.push({ at: line.start, heading: false });
      previous = raw;
      continue;
    }
    if (commentOpen(raw) && !html) {
      if (afterBlank) seams.push({ at: line.start, heading: false });
      comment = true;
      previous = raw;
      continue;
    }
    const fenceOpen = FENCE_OPEN.exec(raw);
    if (fenceOpen && !(fenceOpen[1][0] === '`' && fenceOpen[2].includes('`'))) {
      if (afterBlank) seams.push({ at: line.start, heading: false });
      fence = { character: fenceOpen[1][0], length: fenceOpen[1].length };
      previous = raw;
      continue;
    }
    // A text line (a heading line is one too).
    if (reading) {
      if (htmlLike(raw)) fail('ambiguous_markup');
      const stops = containerStops(raw);
      if (stops.some(at => matchesAt(FENCE_AT, raw, at))) fail('ambiguous_markup');
    }
    const heading = TOP_HEADING.exec(raw);
    if (open) {
      const stops = containerStops(raw);
      const above = previous === null ? '' : contentOf(previous);
      const underlined = TOP_UNDERLINE.test(raw) && previous !== null && !BLANK.test(previous) && !TOP_HEADING.test(previous);
      const anyHeading = stops.some(at => matchesAt(ATX_AT, raw, at));
      const anyUnderline = !BLANK.test(above) && !matchesAt(ANY_ATX_AT, above, 0) && stops.some(at => matchesAt(UNDERLINE_AT, raw, at));
      // A level one or two heading anywhere but the plain top-level form moves nothing.
      if (anyHeading && !(heading && heading[1].length <= 2) || anyUnderline && !underlined) fail('ambiguous_markup');
      if (heading && heading[1].length <= 2) {
        // Inside a fold that started in the area, a heading stays inside; otherwise it ends the area.
        if (depth === 0) close(line.start);
      } else if (underlined) {
        if (depth === 0) fail('underlined_heading');
      } else if (plain && (heading || afterBlank)) {
        seams.push({ at: line.start, heading: Boolean(heading) });
      }
    }
    previous = raw;
  }
  if (start !== -1 && end === -1) close(text.length);
  if (!markers) return { kind: 'none' };
  if (markers > 1) return { kind: 'unsafe', reason: 'two_markers' };
  // GitHub ends a line at a lone carriage return and skips a leading byte-order mark; this reader
  // does neither, so with either anywhere on the page its view of the blocks cannot be trusted.
  if (text.charCodeAt(0) === 0xFEFF || /\r(?!\n)/.test(text)) return { kind: 'unsafe', reason: 'control_character' };
  if (nested || start === -1) return { kind: 'unsafe', reason: 'marker_nested' };
  if (reason) return { kind: 'unsafe', reason };
  const area = text.slice(start, end);
  if (/\r(?!\n)|\u0000|\u2028|\u2029|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(area)) return { kind: 'unsafe', reason: 'control_character' };
  // Link definitions: one that leaves with the area must not be needed by what stays, and one that
  // stays is copied under each part that uses it.
  const within = line => line.start >= start && line.start < end;
  const outside = lines.filter(line => !within(line));
  const leaving = new Set(lines.filter(within).map(line => DEFINITION.exec(line.text)).filter(Boolean).map(match => label(match[1])));
  const needed = usedLabels(outside);
  if ([...leaving].some(name => needed.has(name))) return { kind: 'unsafe', reason: 'link_definition_split' };
  const staying = [];
  for (const line of outside) {
    const definition = DEFINITION.exec(line.text);
    if (definition && !leaving.has(label(definition[1])) && !staying.some(entry => entry.name === label(definition[1]))) staying.push({ name: label(definition[1]), text: line.text });
  }
  const definitionsFor = (from, to) => {
    if (!staying.length) return [];
    const used = usedLabels(lines.filter(line => line.start >= from && line.start < to));
    return staying.filter(entry => used.has(entry.name)).map(entry => entry.text);
  };
  // Splitting stays linear in the page size: a part is measured by arithmetic, counting every link
  // definition that stays as if the part needed it (never fewer than it really gets).
  const room = limit - noteComment('0'.repeat(12), 99, 99, '', staying.map(entry => entry.text)).length;
  const cuts = [start];
  for (let next = 0; end - cuts.at(-1) >= room;) {
    const from = cuts.at(-1);
    while (next < seams.length && seams[next].at <= from) next += 1;
    let chosen = null, heading = null;
    for (let index = next; index < seams.length && seams[index].at < end && seams[index].at - from < room; index += 1) {
      chosen = seams[index];
      if (chosen.heading) heading = chosen;
    }
    if (!chosen) return { kind: 'unsafe', reason: 'part_too_large' };
    cuts.push((heading || chosen).at);
  }
  cuts.push(end);
  const pieces = cuts.slice(1).map((to, index) => ({ text: text.slice(cuts[index], to), definitions: definitionsFor(cuts[index], to) }));
  // The comment format version is part of the key, so a later format can never reuse an older comment.
  const id = digest(JSON.stringify(['v1', pieces.map(piece => [piece.text, piece.definitions])])).slice(0, 12);
  const parts = pieces.map((piece, index) => ({ key: `note-${id}-${index + 1}`, kind: 'note', group: null,
    title: `Archived notes, part ${index + 1} of ${pieces.length}`, body: noteComment(id, index + 1, pieces.length, piece.text, piece.definitions), text: piece.text, count: 1 }));
  return { kind: 'area', start, end, id, parts };
}

module.exports = { GROUPS, digest, marker, graphComments, NOTE_MARKER_LINE, NOTE_KEY, NOTE_REASONS, noteArea, noteText };
