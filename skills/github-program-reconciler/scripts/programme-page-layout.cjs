'use strict';

// The fixed order of a task page: the generated blocks first, then the task's spec sections under
// capital H1 headings, then everything else people wrote under `# More`. Pure text functions: no
// GitHub call and no state read happens here. A page that cannot be split safely throws
// PAGE_LAYOUT_HELD, and the caller updates the blocks where they are instead.
//
// Hand-written words are never changed. A label line (`**The problem:** ...`, `## Done when`)
// becomes its section's heading; the words after or under it are kept byte for byte.

const SPEC_SECTIONS = Object.freeze(['PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE']);
const MORE_HEADING = 'More';
const TASK_BLOCKS = Object.freeze(['NAV', 'STATE', 'TRACE']);
const KNOWN_BLOCKS = Object.freeze(['STATE', 'TRACE', 'NAV', 'CURRENT', 'CONTEXT']);
const LABELS = new Map([...SPEC_SECTIONS.map(label => [label, label]), ['THE PROBLEM', 'PROBLEM'], ['THE FIX', 'FIX'], ['IF WE SKIP IT', 'IF WE SKIP']]);
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

// Every line with its offsets, and whether it is top-level Markdown. Text inside code fences,
// lists, quotes, indented code, HTML blocks and details is never read as a heading or a marker.
// An HTML comment ends at `-->`, and browsers also end it at `--!>`.
const COMMENT_END = /--!?>/;

function markdownLines(source) {
  const result = [];
  let fence = null, html = null, listIndent = 0;
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
      if (html.details) {
        fence = fenceStart(text);
        if (!fence) {
          html.details += detailsDelta(text);
          if (html.details <= 0) html = null;
        }
      } else if (html.until?.test(text) || html.blank && !text.trim()) html = null;
      continue;
    }
    if (!text.trim()) continue;
    const indent = /^ */.exec(text)[0].length;
    if (listIndent && indent >= listIndent || /^(?: {4}| {0,3}\t| {0,3}>)/.test(text)) continue;
    listIndent = 0;
    const list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(text);
    if (list) listIndent = list[0].length;
    fence = fenceStart(text);
    if (fence) continue;
    line.top = true;
    if (/^ {0,3}<details\b/i.test(text)) {
      const details = detailsDelta(text);
      if (details > 0) html = { details };
      continue;
    }
    const literal = /^ {0,3}<(script|pre|style|textarea)\b/i.exec(text);
    if (literal) {
      const until = new RegExp(`</${literal[1]}\\s*>`, 'i');
      if (!until.test(text)) html = { until };
    } else if (/^ {0,3}<!--/.test(text) && !COMMENT_END.test(text)) html = { until: COMMENT_END };
    else if (/^ {0,3}<(?:\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>|[!?])/i.test(text) && !/^ {0,3}<!--.*--!?>[ \t]*$/.test(text)) html = { blank: true };
  }
  return { lines: result, unfinished: Boolean(fence || html?.until || html?.details) };
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
    const { block, error } = findStateBlock(masked, name);
    if (error) throw held(error);
    if (!block) continue;
    if (!names.includes(name)) throw held(`the page has a ${name} block, which belongs to another kind of page`);
    const last = lines.find(line => line.start <= block.end && block.end <= line.end);
    cuts.push({ start: block.start, end: last ? last.end : block.end });
  }
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
  for (const line of lines) {
    if (!line.top) continue;
    const cut = cuts.find(span => span.start <= line.start && line.start < span.end);
    if (cut) {
      if (cut.start === line.start) { keep(line.start, false); start = cut.end; }
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line.text);
    const label = heading ? null : /^(\*\*([^*]+)\*\*:?[ \t]*)(.*)$/.exec(line.text);
    if (!heading && !label) continue;
    const name = normalLabel(heading ? heading[2] : label[2]);
    const depth = heading ? heading[1].length : LABEL_LEVEL;
    const known = (depth <= 2 || depth === LABEL_LEVEL) && LABELS.get(name) || null;
    if (known) {
      keep(line.start);
      if (specs.has(known)) throw held(`the ${known} section appears more than once`);
      parts = [];
      section = known; level = depth;
      start = label && label[3] ? line.start + label[1].length : line.end;
      continue;
    }
    if (!heading) continue;
    if (depth === 1 && name === MORE_HEADING.toUpperCase()) {
      if (more) throw held('the More heading appears more than once');
      more = true;
      keep(line.start);
      section = null; level = 0; start = line.end;
      continue;
    }
    // Someone's own heading ends a spec section opened at its level or deeper; the heading and
    // what follows it are other text.
    if (section !== null && depth <= level) { keep(line.start); section = null; level = 0; start = line.start; }
  }
  keep(text.length);
  return { specs, extra, eol };
}

// The page in its fixed order. `generated` lists [block name, block body] in the order to print.
function buildPage(layout, generated, version, render = null) {
  const draw = render || ((name, content) => state().renderBlock(content, version, name));
  const { specs, extra, eol } = layout;
  const append = (left, right) => {
    if (!left || !right) return left + right;
    const breaks = (/(?:\r?\n){1,2}$/.exec(left)?.[0].match(/\n/g) || []).length;
    return left + eol.repeat(2 - breaks) + right.replace(/^(?:[ \t]*\r?\n)+/, '');
  };
  const under = (heading, body) => `# ${heading}${eol}${eol}${body.replace(/^(?:[ \t]*\r?\n)+/, '')}`;
  let text = generated.reduce((body, [name, content]) => append(body, draw(name, content).replace(/\n/g, eol)), '');
  for (const name of SPEC_SECTIONS) {
    const span = specs.get(name);
    if (span) text = append(text, under(name, span.text));
  }
  if (extra.length) text = append(text, under(MORE_HEADING, extra.reduce((body, span) => append(body, span.text), '')));
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

// Whether a task page already has its three blocks and its text in the fixed order, whatever
// Toolkit version drew the blocks.
function inOrder(source) {
  const { findStateBlock } = state();
  const layout = splitPage(source);
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
// word is still there. Throws PAGE_LAYOUT_HELD otherwise.
function layoutTaskPage(source, generated, version) {
  const layout = splitPage(source);
  const body = buildPage(layout, generated, version);
  const again = splitPage(body);
  if (buildPage(again, generated, version) !== body) throw held('laying the page out twice did not give the same page');
  const joined = { ...layout, extra: layout.extra.length ? [{ text: layout.extra.reduce((text, span) => (text ? `${text.replace(/(?:\r?\n[ \t]*)+$/, '')}\n\n${span.text.replace(/^(?:[ \t]*\r?\n)+/, '')}` : span.text), '') }] : [] };
  if (authoredText(again) !== authoredText(joined)) throw held('the re-laid page would not keep every hand-written word');
  return { body, sections: [...layout.specs.keys()], more: layout.extra.length > 0, moves: withoutBlocks(body) !== withoutBlocks(source) };
}

module.exports = Object.freeze({ SPEC_SECTIONS, MORE_HEADING, TASK_BLOCKS, markdownLines, splitPage, buildPage, inOrder, authoredText, withoutBlocks, layoutTaskPage });
