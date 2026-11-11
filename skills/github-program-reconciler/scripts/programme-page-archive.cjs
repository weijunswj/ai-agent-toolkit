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
// Marked notes (pure). The owner puts old hand-written notes under one `## Archive` line. This
// reader only finds where that area ends and where it may be split; what is inside stays opaque.
// Two line readers run side by side: a strict one (CommonMark-like fences and comments that open a
// line) and a loose one (fences behind list or quote markers, comments opened anywhere). Wherever
// a decision depends on them and they disagree, nothing moves. Every doubt moves less or nothing.
const NOTE_MARKER_LINE = '## Archive';
const NOTE_KEY = /^note-[0-9a-f]{12}-[1-9][0-9]*$/;
const NOTE_REASONS = ['two_markers', 'marker_nested', 'open_fence', 'open_comment', 'open_html', 'ambiguous_markup',
  'underlined_heading', 'control_character', 'link_definition_split', 'part_too_large', 'secret_like', 'comment_not_exact'];
const MANAGED_LINE = /^<!-- AI-AGENT-TOOLKIT:[^\s:]+:(BEGIN|END) /;
const STRICT_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LOOSE_FENCE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t>]+)*(`{3,}|~{3,})(.*)$/;
const RAW_TAGS = ['pre', 'script', 'style', 'textarea'];
const DEFINITION = /^ {0,3}\[([^\]\n]+)\]:[ \t]*\S/;
// Level one or two headings GitHub draws that a plain line test does not see. An HTML heading tag
// (its name may end the line, with the attributes on the next):
const HTML_HEADING = /<h[12](?![\w-])/i;
// ... and a `#` or underlined heading behind any mix of indentation, block quote markers and list
// markers. `containerStops` lists every place such a heading could start, in one left-to-right scan.
const LIST_MARKER = /(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/y;
const ATX_AT = /#{1,2}(?:[ \t]|$)/y;
const UNDERLINE_AT = /(?:=+|-+)[ \t]*$/y;
const ANY_ATX_AT = /#{1,6}(?:[ \t]|$)/y;
function containerStops(line) {
  const stops = [0];
  for (let at = 0; at < line.length;) {
    let next = at;
    while (next < line.length && (line[next] === ' ' || line[next] === '\t')) next += 1;
    if (next === at && line[at] === '>') next = at + 1;
    if (next === at) { LIST_MARKER.lastIndex = at; if (LIST_MARKER.test(line)) next = LIST_MARKER.lastIndex; }
    if (next === at) break;
    stops.push(next);
    at = next;
  }
  return stops;
}
const matchesAt = (pattern, line, at) => { pattern.lastIndex = at; return pattern.test(line); };
// What a line's content is once every container prefix is removed.
const contentOf = line => line.slice(containerStops(line).at(-1));
// A fold or raw-text tag name, wherever it is written (a tag, code, a comment, an escape, an attribute).
const TAG_MENTION = /<\/?(?:details|pre|script|style|textarea)(?![\w-])/i;
// The only lines whose tags the reader counts: a whole tag on its own line, outside any container.
const PLAIN_TAG_LINE = /^ {0,3}(?:<details(?:[ \t][^<>`]*)?>(?:[ \t]*<summary>[^<>`]*<\/summary>)?|<\/details>|<\/?(?:pre|script|style|textarea)(?:[ \t][^<>`]*)?>)[ \t]*$/i;

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

// Which span (an HTML comment, a CDATA section, a processing instruction or a declaration, the
// HTML blocks GitHub runs past blank lines) is open after this line, or false. `kind` is the span
// open before it.
const SPANS = { comment: '-->', cdata: ']]>', pi: '?>', declaration: '>' };
const SPAN_START = /<!--|<!\[CDATA\[|<\?|<![A-Za-z]/g;
const SPAN_KIND = { '<!--': 'comment', '<![CDATA[': 'cdata', '<?': 'pi' };
function spanAfter(line, open, kind) {
  for (let at = 0; ;) {
    if (open) {
      const found = line.indexOf(SPANS[kind], at);
      if (found === -1) return kind;
      at = found + SPANS[kind].length; open = false;
    } else {
      SPAN_START.lastIndex = at;
      const next = SPAN_START.exec(line);
      if (!next) return false;
      kind = SPAN_KIND[next[0]] || 'declaration';
      // `<!-->` and `<!--->` are whole comments to GitHub, so the end may overlap the start.
      at = next.index + (kind === 'comment' || kind === 'declaration' ? 2 : next[0].length); open = true;
    }
  }
}

// One step of one reader. `strict` reads fences and line-opening comments as CommonMark does at
// the top level. `loose` also takes fences behind list or quote markers and comments or CDATA
// opened anywhere. `container` is loose, but a fence opened behind an indent or a marker ends at
// the first less-indented line, as it does when its list item or quote ends.
function advance(state, line, mode) {
  const pattern = mode === 'strict' ? STRICT_FENCE : LOOSE_FENCE;
  if (state.fence && mode === 'container' && state.fence.indent > 0 && line.trim() && /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length < state.fence.indent) state.fence = null;
  if (state.fence) {
    const close = pattern.exec(line);
    if (close && close[1][0] === state.fence.character && close[1].length >= state.fence.length && !close[2].trim()) state.fence = null;
    return;
  }
  if (state.comment) { state.comment = spanAfter(line, true, state.comment); return; }
  const open = pattern.exec(line);
  if (open && (open[1][0] !== '`' || !open[2].includes('`'))) { state.fence = { character: open[1][0], length: open[1].length, indent: line.indexOf(open[1]) }; return; }
  if (mode !== 'strict') state.comment = spanAfter(line, false, null);
  else if (/^ {0,3}(?:<!--|<!\[CDATA\[|<\?|<![A-Za-z])/.test(line)) state.comment = spanAfter(line, false, null);
}

const count = (line, pattern) => (line.match(pattern) || []).length;
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
function noteArea(body, { limit = COMMENT_LIMIT } = {}) {
  const text = String(body || '');
  const lines = sourceLines(text);
  const strict = { fence: null, comment: false }, loose = { fence: null, comment: false }, container = { fence: null, comment: false };
  const readers = [[strict, 'strict'], [loose, 'loose'], [container, 'container']];
  const depth = { strict: 0, loose: 0 };
  // `raw` counts open raw-text tags; `html` is true from a line that opens an HTML block to the next blank line.
  let raw = 0, html = false;
  const reset = () => { for (const [state] of readers) { state.fence = null; state.comment = false; } depth.strict = depth.loose = 0; raw = 0; html = false; };
  const inside = state => Boolean(state.fence || state.comment);
  const everywhere = () => readers.every(([state]) => inside(state));
  const nowhere = () => readers.every(([state]) => !inside(state));
  const neutral = () => nowhere() && depth.strict === 0 && depth.loose === 0 && raw === 0;
  let markers = 0, nested = false, managed = false, start = -1, end = -1, reason = null, stray = false, previous = null, tagDoubt = false;
  const seams = [];
  const fail = why => { reason ||= why; };
  const close = at => {
    if (strict.fence) fail('open_fence');
    else if (strict.comment) fail('open_comment');
    else if (!nowhere()) fail('ambiguous_markup');
    else if (depth.strict || depth.loose || raw || stray) fail('open_html');
    end = at;
  };
  for (const line of lines) {
    const open = start !== -1 && end === -1;
    const block = MANAGED_LINE.exec(line.text);
    if (block || managed) {
      if (line.text === NOTE_MARKER_LINE) { markers += 1; nested = true; }
      if (block?.[1] === 'BEGIN') { if (open) close(line.start); managed = true; }
      if (block?.[1] === 'END') managed = false;
      if (block) reset();
      previous = null;
      continue;
    }
    const plain = neutral();
    if (line.text === NOTE_MARKER_LINE) {
      markers += 1;
      if (!plain || html) nested = true;
      else if (start === -1) start = line.start;
    } else if (open) {
      // Inside a code block or comment by every reading, or inside a folded section by both counts.
      const skipped = everywhere() || nowhere() && depth.strict > 0 && depth.loose > 0 && raw === 0;
      // Route A: a level one or two heading anywhere but the plain top-level form ends nothing and
      // moves nothing, because GitHub may draw it where this reader cannot follow.
      const top = /^ {0,3}#{1,2}(?:[ \t]|$)/.test(line.text);
      const underlined = /^ {0,3}(?:=+|-+)[ \t]*$/.test(line.text) && previous !== null && previous.trim() && !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(previous);
      const stops = containerStops(line.text);
      const above = previous === null ? '' : contentOf(previous);
      const anyHeading = stops.some(at => matchesAt(ATX_AT, line.text, at));
      const anyUnderline = Boolean(above.trim()) && !matchesAt(ANY_ATX_AT, above, 0) && stops.some(at => matchesAt(UNDERLINE_AT, line.text, at));
      if (!everywhere() && (HTML_HEADING.test(line.text) || anyHeading && !top || anyUnderline && !underlined)) fail('ambiguous_markup');
      if (top) {
        if (plain) { close(line.start); }
        else if (!skipped) fail('ambiguous_markup');
      } else if (underlined) {
        if (plain) fail('underlined_heading');
        else if (!skipped) fail('ambiguous_markup');
      } else if (plain && (/^ {0,3}#{3,6}(?:[ \t]|$)/.test(line.text) || previous !== null && !previous.trim())) {
        seams.push({ at: line.start, heading: /^ {0,3}#/.test(line.text) });
      }
    }
    const hidden = inside(strict);
    const prior = readers.map(([state]) => ({ fence: Boolean(state.fence), comment: state.comment }));
    const before = prior.map(entry => entry.fence || Boolean(entry.comment));
    for (const [state, mode] of readers) advance(state, line.text, mode);
    // Route C: inside an HTML block GitHub opens no code block or comment, so a fence or comment the
    // readers open there may be text to GitHub, and every later fence or comment pairs up differently.
    const opened = readers.some(([state], index) => !before[index] && inside(state));
    if (end === -1 && html && line.text.trim() && opened) tagDoubt = true;
    // Route E: a code block or comment that opens behind indentation or a list or quote marker may
    // belong to a list item or quote that GitHub ends sooner or later than these readers do, and then
    // every later fence or comment pairs up differently. Only one that opens at the start of a line
    // is followed.
    if (end === -1 && opened && !/^(?:`{3}|~{3}|<!--)/.test(line.text)) tagDoubt = true;
    // Route B: a fold or raw-text tag counts only on a plain tag line. Any other mention up to the
    // end of the area (in code, a comment, an escape, an attribute, a list or a quote, or split over
    // lines) moves nothing, unless every reader holds the whole line inside one code block or comment.
    // Sealed: every reader holds the whole line inside one code block, or inside one comment-like span
    // that this line does not end.
    const sealed = readers.every(([state], index) => prior[index].fence && state.fence || prior[index].comment && state.comment && !line.text.includes(SPANS[prior[index].comment]));
    if (end === -1 && TAG_MENTION.test(line.text)) {
      if (!sealed && !(PLAIN_TAG_LINE.test(line.text) && before.every(state => !state) && nowhere())) tagDoubt = true;
    }
    // Route D: a processing instruction, declaration or CDATA section is raw text to GitHub's
    // Markdown but a comment that ends at the first `>` to its HTML parser, so the two disagree on
    // what is drawn. None of them is ordinary in notes: any one moves nothing.
    if (end === -1 && !sealed && /<!\[CDATA\[|<\?|<![A-Za-z]/.test(line.text)) tagDoubt = true;
    const opens = count(line.text, /<details(?=[\s>])/gi), closes = count(line.text, /<\/details\s*>/gi);
    if (!hidden && !inside(strict)) depth.strict += opens - closes;
    depth.loose += opens - closes;
    for (const tag of RAW_TAGS) raw += count(line.text, new RegExp(`<${tag}(?=[\\s>])`, 'gi')) - count(line.text, new RegExp(`</${tag}\\s*>`, 'gi'));
    if (depth.strict < 0 || depth.loose < 0 || raw < 0) { if (start !== -1 && end === -1) stray = true; depth.strict = Math.max(0, depth.strict); depth.loose = Math.max(0, depth.loose); raw = Math.max(0, raw); }
    if (!line.text.trim()) html = false;
    else if (/^ {0,3}<[A-Za-z/!?]/.test(line.text) && !/^ {0,3}<!--.*-->[ \t]*$/.test(line.text)) html = true;
    previous = line.text;
  }
  if (start !== -1 && end === -1) close(text.length);
  if (!markers) return { kind: 'none' };
  if (markers > 1) return { kind: 'unsafe', reason: 'two_markers' };
  // GitHub ends a line at a lone carriage return and skips a leading byte-order mark; this reader
  // does neither, so with either anywhere on the page its view of the blocks cannot be trusted.
  if (text.charCodeAt(0) === 0xFEFF || /\r(?!\n)/.test(text)) return { kind: 'unsafe', reason: 'control_character' };
  if (nested || start === -1) return { kind: 'unsafe', reason: 'marker_nested' };
  if (reason) return { kind: 'unsafe', reason };
  if (tagDoubt) return { kind: 'unsafe', reason: 'ambiguous_markup' };
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
