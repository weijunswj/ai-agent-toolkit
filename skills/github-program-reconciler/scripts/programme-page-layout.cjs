'use strict';

// The fixed order of a task page: the PATH block, then `# TASK` holding the task's spec sections,
// then `# PLAN`, then the other generated blocks (PR GRAPH, AGENT CONTEXT), then everything else
// people wrote, under their own headings. Pure text functions: no GitHub call and no state read
// happens here. A page that cannot be split safely throws PAGE_LAYOUT_HELD, and the caller updates
// the blocks where they are instead.
//
// Hand-written words are never changed. A label line (`**The problem:** ...`, `## Done when`)
// becomes its part of TASK; the words after or under it are kept byte for byte. Under TASK, WHY and
// DONE WHEN are `##` headings; the problem, the fix and what happens if we skip it are `###`
// headings inside WHY, and what is not in scope is a bold label inside DONE WHEN. PLAN is a `#`
// heading of its own after TASK. WHAT is no longer written for new tasks (the problem and the fix
// say it); a page that still has one keeps it as `## WHAT` at the top of TASK.
//
// Heading rule: generated headings are in capitals; a heading people write below the generated
// blocks is in Title Case. Only a hand-written heading there that reuses a generated name in
// capitals (RESERVED) holds the page, naming it, since it would read as a generated part; any other
// heading is left as written.

const SPEC_SECTIONS = Object.freeze(['WHAT', 'WHY', 'PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE', 'PLAN']);
const TASK_HEADING = 'TASK';
const PLAN_HEADING = 'PLAN';
// Older Toolkit versions put the hand-written text under this heading. It is read and dropped.
const MORE_HEADING = 'More';
const TASK_BLOCKS = Object.freeze(['NAV', 'STATE', 'TRACE']);
// The generated blocks printed above TASK; the rest follow it.
const ABOVE_TASK = Object.freeze(['NAV']);
// The WHY parts, printed as `###` headings. Inside `## WHY` they are read from a `###` heading too.
const WHY_PARTS = Object.freeze(['PROBLEM', 'FIX', 'IF WE SKIP']);
const KNOWN_BLOCKS = Object.freeze(['STATE', 'TRACE', 'NAV', 'CURRENT', 'CONTEXT']);
const LABELS = new Map([...SPEC_SECTIONS.map(label => [label, label]), ['THE PROBLEM', 'PROBLEM'], ['THE FIX', 'FIX'], ['IF WE SKIP IT', 'IF WE SKIP']]);
// Parts that only a heading opens: a bold `**Plan:**` in someone's notes stays where it is.
const HEADING_ONLY = new Set(['WHAT', 'WHY', 'PLAN']);
// The part printed as a bold label, and its words.
const LABEL_TEXT = Object.freeze({ 'NOT IN SCOPE': 'Not in scope' });
// A bold label opens a section that any later heading closes.
const LABEL_LEVEL = 7;

// Loaded on first use: programme-state.cjs requires this file.
const state = () => require('./programme-state.cjs');

function held(reason) {
  const { ProgrammeError } = state();
  const error = new ProgrammeError('PAGE_LAYOUT_HELD', reason);
  error.reason = reason;
  return error;
}

const normalLabel = text => text.trim().replace(/[:.]$/, '').trim().toUpperCase();

// The names generated headings use, on task pages and the programme page.
const RESERVED = new Set(['PATH', 'TASK', 'WHAT', 'WHY', 'PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE', 'PLAN', 'PR GRAPH', 'STATUS', 'AGENT CONTEXT', 'DECISIONS', 'CURRENT', 'PROGRAMME GRAPH']);
const reserved = text => RESERVED.has(text.trim().replace(/[:.]$/, '').trim());

// Every line with its offsets, and whether it is top-level Markdown. Text inside code fences,
// lists, quotes, indented code, HTML blocks and details is never read as a heading or a marker.
// An HTML comment ends at `-->`, and browsers also end it at `--!>`.
const COMMENT_END = /--!?>/;

const TOOLKIT_MARKER = /^<!-- AI-AGENT-TOOLKIT:[^\s]+:(?:BEGIN|END) [A-Z-]+\b[^\n]*-->[ \t]*$/;

function markdownLines(source) {
  const result = [];
  // `fenceAt` and `htmlAt` are where the code block or HTML block now open began.
  let fence = null, html = null, listIndent = 0, fenceAt = 0, htmlAt = 0;
  const fenceStart = text => {
    const opening = /^ {0,3}(~{3,}|`{3,})(.*)$/.exec(text);
    return opening && (opening[1][0] === '~' || !opening[2].includes('`')) ? opening[1] : null;
  };
  const detailsDelta = text => (/^ {0,3}<\/?details\b/i.test(text)
    ? [...text.matchAll(/<(\/?)details\b[^>]*>/gi)].reduce((depth, match) => depth + (match[1] ? -1 : 1), 0) : 0);
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) break;
    const start = match.index;
    const end = start + match[0].length;
    const text = match[0].replace(/\r?\n$/, '');
    const line = { start, end, text, top: false };
    result.push(line);
    if (fence) {
      const closing = /^ {0,3}([~`]+)[ \t]*$/.exec(text);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length && [...closing[1]].every(char => char === fence[0])) fence = null;
      continue;
    }
    if (html) {
      let marker = false;
      if (html.details) {
        fence = fenceStart(text);
        if (fence) fenceAt = start;
        else {
          html.details += detailsDelta(text);
          if (html.details <= 0) html = null;
        }
      } else if (html.comment && TOOLKIT_MARKER.test(text)) {
        // A Toolkit marker line is itself an HTML comment, so it ends a comment left open above it,
        // as a browser reads it, and what follows is shown: the marker is read as a real one.
        html = null;
        marker = true;
      } else if (html.until?.test(text) || html.blank && !text.trim()) html = null;
      // A Toolkit marker line also ends an HTML block that only a blank line would end otherwise,
      // so a block written straight under a line of HTML is still found.
      if (html?.blank && TOOLKIT_MARKER.test(text)) { html = null; marker = true; }
      if (!marker) continue;
    }
    if (!text.trim()) continue;
    const indent = /^ */.exec(text)[0].length;
    if (listIndent && indent >= listIndent || /^(?: {4}| {0,3}\t| {0,3}>)/.test(text)) continue;
    listIndent = 0;
    const list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(text);
    if (list) listIndent = list[0].length;
    fence = fenceStart(text);
    if (fence) { fenceAt = start; continue; }
    line.top = true;
    if (/^ {0,3}<details\b/i.test(text)) {
      const details = detailsDelta(text);
      if (details > 0) { html = { details }; htmlAt = start; }
      continue;
    }
    const literal = /^ {0,3}<(script|pre|style|textarea)\b/i.exec(text);
    if (literal) {
      const until = new RegExp(`</${literal[1]}\\s*>`, 'i');
      if (!until.test(text)) { html = { until }; htmlAt = start; }
    } else if (/^ {0,3}<!--/.test(text) && !COMMENT_END.test(text)) { html = { until: COMMENT_END, comment: true }; htmlAt = start; }
    else if (/^ {0,3}<(?:\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>|[!?])/i.test(text) && !/^ {0,3}<!--.*--!?>[ \t]*$/.test(text)) html = { blank: true };
  }
  // `unfinishedFrom` is where the block that never closes began: lines before it read as usual.
  const unfinished = Boolean(fence || html?.until || html?.details);
  return { lines: result, unfinished, unfinishedFrom: !unfinished ? null : html?.until || html?.details ? htmlAt : fenceAt };
}

// A task page split into its managed blocks (cut out), its spec sections and its other text.
// `specs` maps a section name to its text span; `extra` lists every other span in page order.
function splitPage(source, names = TASK_BLOCKS) {
  const { findStateBlock, BLOCK_SOURCE } = state();
  const text = String(source || '');
  const { lines, unfinished } = markdownLines(text);
  if (unfinished) throw held('a code block, HTML block or details section is not closed');
  const top = new Set(lines.filter(line => line.top).map(line => line.start));
  // Mask literal examples without changing offsets or line endings.
  const masked = lines.map(line => (top.has(line.start) ? text.slice(line.start, line.end) : text.slice(line.start, line.end).replace(/[^\r\n]/g, ' '))).join('');
  const marker = new RegExp(`^\\s*<!--\\s*AI-AGENT-TOOLKIT:${BLOCK_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(?:BEGIN|END) ([A-Z]+)\\b`);
  for (const line of lines.filter(line => line.top)) {
    const found = marker.exec(line.text);
    if (found && !KNOWN_BLOCKS.includes(found[1])) throw held(`the page has a ${found[1]} marker this Toolkit does not know`);
  }
  const cuts = [];
  for (const name of KNOWN_BLOCKS) {
    const { block, error } = findStateBlock(masked, name, { literal: true });
    if (error) throw held(error);
    if (!block) continue;
    if (!names.includes(name)) throw held(`the page has a ${name} block, which belongs to another kind of page`);
    const last = lines.find(line => line.start <= block.end && block.end <= line.end);
    cuts.push({ start: block.start, end: last ? last.end : block.end });
  }
  // A marker line closes a comment left open above it, so the hand-written text is checked with the
  // blocks cut out: whether a page can be laid out never depends on where its blocks sit.
  let hand = '', from = 0;
  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) { hand += text.slice(from, cut.start); from = cut.end; }
  if (cuts.length && markdownLines(hand + text.slice(from)).unfinished) throw held('a code block, HTML block or details section is not closed');
  const extra = [];
  const specs = new Map();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  // A block inside a section (an older page keeps its status block under the first heading) splits
  // that section's text in two; the parts are one section again once the block is cut out.
  let section = null, level = 0, start = 0, parts = [];
  const keep = (end, closes = true) => {
    const piece = text.slice(start, end);
    if (section === null) {
      if (piece.trim()) extra.push({ start, end, text: piece });
      return;
    }
    if (piece.trim()) parts.push(piece);
    if (!closes) return;
    const joined = parts.reduce((whole, part) => (whole ? `${whole.replace(/(?:\r?\n[ \t]*)+$/, '')}${eol}${eol}${part.replace(/^(?:[ \t]*\r?\n)+/, '')}` : part), '');
    parts = [];
    if (!joined.trim()) return;
    if (specs.has(section)) throw held(`the ${section} section appears more than once`);
    specs.set(section, { text: joined });
  };
  let more = false;
  // Under `# TASK` or `# PLAN` (a page this layout drew), only a part's own heading or label, an H1
  // or a block ends a part: a heading people write inside a part stays in it. The first block below
  // them ends that reading, so text under the blocks is never taken into the last part.
  let task = false, tasks = 0;
  // Headings people wrote with a generated name in the text that goes below the generated blocks.
  const taken = [];
  const other = (line, heading) => { if (reserved(heading[2])) taken.push(line.text.trim()); };
  for (const line of lines) {
    if (!line.top) continue;
    const cut = cuts.find(span => span.start <= line.start && line.start < span.end);
    if (cut) {
      if (cut.start === line.start) {
        keep(line.start, task);
        if (task) { section = null; level = 0; task = false; }
        start = cut.end;
      }
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line.text);
    const label = heading ? null : /^(\*\*([^*]+)\*\*:?[ \t]*)(.*)$/.exec(line.text);
    if (!heading && !label) continue;
    const name = normalLabel(heading ? heading[2] : label[2]);
    const depth = heading ? heading[1].length : LABEL_LEVEL;
    // A `###` WHY part is read only inside `## WHY` (or another WHY part), with or without `# TASK`:
    // the same heading in PLAN, DONE WHEN or someone's notes stays where it is.
    const inWhy = section === 'WHY' || WHY_PARTS.includes(section);
    const known = (depth <= 2 || depth === LABEL_LEVEL && !HEADING_ONLY.has(LABELS.get(name))
      || inWhy && depth === 3 && WHY_PARTS.includes(LABELS.get(name))) && LABELS.get(name) || null;
    if (depth === 1 && name === TASK_HEADING) {
      if ((tasks += 1) > 1) throw held('the TASK heading appears more than once');
      keep(line.start);
      task = true; section = null; level = 0; start = line.end;
      continue;
    }
    if (known) {
      keep(line.start);
      if (specs.has(known)) throw held(`the ${known} section appears more than once`);
      parts = [];
      section = known; level = depth;
      start = label && label[3] ? line.start + label[1].length : line.end;
      // The generated `# PLAN` heading reads like `# TASK`: what follows the blocks is not the plan.
      if (heading && depth === 1 && heading[2] === PLAN_HEADING) task = true;
      continue;
    }
    if (!heading) continue;
    if (depth === 1 && name === MORE_HEADING.toUpperCase()) {
      if (more) throw held('the More heading appears more than once');
      more = true;
      keep(line.start);
      task = false; section = null; level = 0; start = line.end;
      continue;
    }
    if (task) {
      if (depth > 1) { if (section === null) other(line, heading); continue; }
      keep(line.start); task = false; section = null; level = 0; start = line.start;
      other(line, heading);
      continue;
    }
    // Someone's own heading ends a spec section opened at its level or deeper; the heading and
    // what follows it are other text.
    if (section !== null && depth <= level) { keep(line.start); section = null; level = 0; start = line.start; }
    if (section === null) other(line, heading);
  }
  keep(text.length);
  if (taken.length) throw held(`the hand-written heading ${taken.map(entry => `\`${entry}\``).join(', ')} reuses a generated heading's name: write it in Title Case or rename it`);
  return { specs, extra, eol };
}

// A part's words follow its label on the same line when they start as a plain paragraph; a list,
// heading, code, quote, table, HTML or link definition starts on its own line under the label.
const BLOCK_START = /^(?:[-+*][ \t]|\d{1,9}[.)](?:[ \t]|$)|#|>|`{3}|~{3}|\||<|\[[^\]]*\]:|\*\*[^*]+\*\*|(?:[-*_][ \t]*){3,}$)/;

// The page in its fixed order. `generated` lists [block name, block body] in the order to print;
// PATH goes above TASK and the others below it.
function buildPage(layout, generated, version, render = null) {
  const draw = render || ((name, content) => state().renderBlock(content, version, name));
  const { specs, extra, eol } = layout;
  const append = (left, right) => {
    if (!left || !right) return left + right;
    const breaks = (/(?:\r?\n){1,2}$/.exec(left)?.[0].match(/\n/g) || []).length;
    return left + eol.repeat(2 - breaks) + right.replace(/^(?:[ \t]*\r?\n)+/, '');
  };
  const words = body => body.replace(/^(?:[ \t]*\r?\n)+/, '');
  const under = (heading, body, level = 1) => `${'#'.repeat(level)} ${heading}${eol}${eol}${words(body)}`;
  const labelled = name => {
    const body = words(specs.get(name).text);
    const first = body.split(/\r?\n/, 1)[0];
    return /^\S/.test(first) && !BLOCK_START.test(first) ? `**${LABEL_TEXT[name]}:** ${body}` : `**${LABEL_TEXT[name]}:**${eol}${eol}${body}`;
  };
  // A part with its `##` heading, then its sub-parts: `###` headings, or bold labels.
  const part = (name, subs, labels = []) => {
    if (![name, ...subs, ...labels].some(key => specs.has(key))) return '';
    const head = specs.has(name) ? under(name, specs.get(name).text, 2) : `## ${name}`;
    const withSubs = subs.filter(key => specs.has(key)).reduce((body, key) => append(body, under(key, specs.get(key).text, 3)), head);
    return labels.filter(key => specs.has(key)).reduce((body, key) => append(body, labelled(key)), withSubs);
  };
  const blocks = names => generated.filter(([name]) => names(name)).reduce((body, [name, content]) => append(body, draw(name, content).replace(/\n/g, eol)), '');
  let text = blocks(name => ABOVE_TASK.includes(name));
  const parts = [part('WHAT', []), part('WHY', WHY_PARTS), part('DONE WHEN', [], ['NOT IN SCOPE'])].filter(Boolean);
  if (parts.length) text = append(text, parts.reduce(append, `# ${TASK_HEADING}`));
  if (specs.has('PLAN')) text = append(text, under(PLAN_HEADING, specs.get('PLAN').text));
  text = append(text, blocks(name => !ABOVE_TASK.includes(name)));
  if (extra.length) text = append(text, extra.reduce((body, span) => append(body, span.text), ''));
  // The page ends with one line ending, whatever blank lines the last piece of text carried.
  return text.replace(/(?:\r?\n[ \t]*)+$/, '') + eol;
}

// What people wrote, in a form that survives a re-lay: each spec section's words and the other
// text, with blank lines at the joins and line endings ignored. Equal before and after a re-lay.
function authoredText(layout) {
  const tidy = text => text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/\n(?:[ \t]*\n)+/g, '\n\n');
  return JSON.stringify([SPEC_SECTIONS.map(name => (layout.specs.has(name) ? tidy(layout.specs.get(name).text) : null)),
    layout.extra.map(span => tidy(span.text)).filter(Boolean).join('\n\n')]);
}

// The page with its managed blocks cut out: equal before and after a write that moves no
// hand-written text.
function withoutBlocks(source, names = KNOWN_BLOCKS) {
  const { findStateBlock } = state();
  let text = String(source || '');
  for (const name of names) {
    const { block } = findStateBlock(text, name);
    if (block) text = text.slice(0, block.start) + text.slice(block.end);
  }
  return text;
}

// Notes marked under one `## Archive` line on a task page: the line and what follows it, up to the
// next level one or two heading, the next generated block or the end of the page. Text inside code,
// lists, quotes, comments and details is never read as the line. Returns null without a marked area;
// throws PAGE_LAYOUT_HELD for a second line, or a link line in the area that text outside it uses.
const ARCHIVE_LINE = '## Archive';
function archiveArea(source) {
  const text = String(source || '');
  const { lines } = markdownLines(text);
  const marks = lines.filter(line => line.top && line.text.replace(/\r$/, '') === ARCHIVE_LINE);
  if (!marks.length) return null;
  if (marks.length > 1) throw held('the `## Archive` line appears more than once');
  const start = marks[0].start;
  const close = lines.find(line => line.start > start && line.top && (/^ {0,3}#{1,2}[ \t]/.test(line.text) || TOOLKIT_MARKER.test(line.text)));
  const end = close ? close.start : text.length;
  const inside = text.slice(start, end);
  const outside = text.slice(0, start) + text.slice(end);
  const used = new Set([...outside.matchAll(/\[([^\]\n]+)\](?!:)/g)].map(match => match[1].trim().toLowerCase()));
  for (const match of inside.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*\S/gm)) {
    if (used.has(match[1].trim().toLowerCase())) throw held('a link line under `## Archive` is used elsewhere on the page');
  }
  return { start, end };
}

// The page with its marked notes replaced by one line linking the saved copy of the whole page.
// `archiveLink` turns the copy's SHA-256 into its link; the copy itself is saved by the caller
// before the page is written.
function withoutArchive(source, archiveLink) {
  const area = archiveArea(source);
  if (!area) return source;
  if (!archiveLink) throw held('marked notes need the private store for their saved copy');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const line = `Archived notes: [page copy](${archiveLink(state().sha256(source))})${eol}`;
  return source.slice(0, area.start) + line + (area.end < source.length ? eol : '') + source.slice(area.end);
}

// Whether a task page already has its three blocks and its text in the fixed order, whatever
// Toolkit version drew the blocks. A page with notes marked under `## Archive` is not: they move.
function inOrder(source) {
  const { findStateBlock } = state();
  const layout = splitPage(source);
  if (archiveArea(source)) return false;
  let skeleton = String(source || '');
  for (const name of TASK_BLOCKS) {
    const { block } = findStateBlock(skeleton, name);
    if (!block) return false;
    skeleton = `${skeleton.slice(0, block.start)}<<${name}>>${skeleton.slice(block.end)}`;
  }
  const built = buildPage(layout, TASK_BLOCKS.map(name => [name, null]), null, name => `<<${name}>>`);
  return built.replace(/\s+$/, '') === skeleton.replace(/\s+$/, '');
}

// The re-laid task page, checked: laying it out again gives the same bytes, and every hand-written
// word is still there, except notes marked under `## Archive`, which give way to the link to the
// saved copy that holds them (see withoutArchive). Throws PAGE_LAYOUT_HELD otherwise.
function layoutTaskPage(original, generated, version, { archiveLink = null } = {}) {
  const source = withoutArchive(original, archiveLink);
  const layout = splitPage(source);
  const body = buildPage(layout, generated, version);
  const again = splitPage(body);
  if (buildPage(again, generated, version) !== body) throw held('laying the page out twice did not give the same page');
  const joined = { ...layout, extra: layout.extra.length ? [{ text: layout.extra.reduce((text, span) => (text ? `${text.replace(/(?:\r?\n[ \t]*)+$/, '')}\n\n${span.text.replace(/^(?:[ \t]*\r?\n)+/, '')}` : span.text), '') }] : [] };
  if (authoredText(again) !== authoredText(joined)) throw held('the re-laid page would not keep every hand-written word');
  return { body, sections: [...layout.specs.keys()], more: layout.extra.length > 0, archived: source !== original, moves: withoutBlocks(body) !== withoutBlocks(original) };
}

module.exports = Object.freeze({ SPEC_SECTIONS, TASK_HEADING, PLAN_HEADING, MORE_HEADING, TASK_BLOCKS, ARCHIVE_LINE, markdownLines, splitPage, buildPage, inOrder, authoredText, withoutBlocks, archiveArea, withoutArchive, layoutTaskPage });
