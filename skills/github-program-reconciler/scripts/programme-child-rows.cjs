'use strict';

// Readers of a task page's checkbox rows, shared by the sweep's stale-work findings
// (programme-state.cjs) and the controller check. Pure functions over the page text; nothing here
// reads GitHub or writes anything.

// The polish child's row cap: at this many rows it is full, above it over cap.
const POLISH_CAP = 8;
const DONE_WHEN = /^#{1,6} +DONE WHEN\b.*$/im;

// The text under a heading, up to the next heading of the same or a higher level; null without it.
function sectionOf(body, heading) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const start = heading.exec(text);
  if (!start) return null;
  const level = /^#+/.exec(start[0])[0].length;
  const rest = text.slice(start.index + start[0].length);
  const end = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
  return { heading: start[0], text: end ? rest.slice(0, end.index) : rest };
}

// Polish rows are the checkboxes under the child's ROWS heading, else under DONE WHEN; the result
// says which it counted, so a body in another shape is visible rather than silently miscounted.
function polishRows(body) {
  for (const heading of [/^#{1,6} +ROWS\b.*$/im, DONE_WHEN]) {
    const found = sectionOf(body, heading);
    if (!found) continue;
    const rows = found.text.match(/^ {0,3}[-*+] \[[ xX]\] /gm) || [];
    return { rows: rows.length, under: /ROWS/i.test(found.heading) ? 'ROWS' : 'DONE WHEN' };
  }
  return { rows: 0, under: 'no ROWS or DONE WHEN heading' };
}

// The unchecked DONE WHEN rows of a page, nested ones too.
function uncheckedRows(body) {
  const doneWhen = sectionOf(body, DONE_WHEN);
  return doneWhen ? (doneWhen.text.match(/^[ \t]*[-*+] \[ \] /gm) || []).length : 0;
}

// What a reader takes of a task page to see a merged PR whose rows stay unticked. A default-deny
// reader over this subset of GitHub's Markdown, and nothing else:
//   - lines split on LF only (CRLF counts as LF); no other character starts a line;
//   - a row is `- [ ] ` or `- [x] ` (`*` or `+` for `-`, X in either case) with 0 to 3 spaces before
//     it, under an ATX heading whose text starts `DONE WHEN` or `ROWS`, up to the next heading of the
//     same or a higher level; fenced code (``` or ~~~, to its closing fence or the end) and an HTML
//     comment block (a line starting `<!--`, to the line holding `-->`) hold no rows or headings;
//   - a merged PR is a row of the one STATE block the sweep draws (one BEGIN STATE line, then one END
//     STATE line) whose status cell starts MERGED and whose Merged SHA cell links a full commit.
// Only a row in that subset counts as ticked, and only such a STATE row as merged: a tab or deeper
// indent, a quote, another marker or check character, or any other shape is never read as either.
// `done_when` counts the rows under DONE WHEN alone (ticked, and all of them), for the graph's
// Progress count.
const ROWS_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const CHECKBOX = /^ {0,3}[-*+] \[([ xX])\] /;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const STATE_BEGIN = /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v\d+ .*-->$/;
const STATE_END = /^<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->$/;
const MERGED_ROW = /^\|.*\|#(\d+)\|MERGED(?: · [^|]*)?\|\[[0-9a-f]{7,40}\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[0-9a-f]{40}\)\|$/;
// A generated block's BEGIN or END line (toolkit-managed-block.cjs markers).
const MANAGED = /^<!-- AI-AGENT-TOOLKIT:[^\s:]+:(BEGIN|END) /;

// The one line walk both readers below share, so the rows the backfill converts are exactly the rows
// the count then counts. `top(line, index)` sees each line outside fenced code and comment blocks;
// `row(line, index, { doneWhen, generated })` sees each such line that is neither a heading, a fence
// nor a comment, while it stands under a DONE WHEN or ROWS heading. `generated` is true between a
// generated block's BEGIN and END lines.
function walkRows(lines, { top = () => {}, row = () => {} }) {
  let fence = null, comment = false, section = 0, doneWhen = false, generated = 0;
  lines.forEach((line, index) => {
    if (fence) {
      if (new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
      return;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      return;
    }
    top(line, index, generated > 0);
    const open = FENCE_OPEN.exec(line);
    if (open) { fence = open[1]; return; }
    if (/^ {0,3}<!--/.test(line)) {
      const managed = MANAGED.exec(line);
      if (managed) generated = Math.max(0, generated + (managed[1] === 'BEGIN' ? 1 : -1));
      comment = !line.slice(line.indexOf('<!--') + 4).includes('-->');
      return;
    }
    const heading = ROWS_HEADING.exec(line);
    if (heading) {
      if (section && heading[1].length <= section) section = 0;
      const named = /^(DONE WHEN|ROWS)\b/i.exec(heading[2]);
      if (named) { section = heading[1].length; doneWhen = /^DONE WHEN$/i.test(named[1]); }
      return;
    }
    if (section) row(line, index, { doneWhen, generated: generated > 0 });
  });
}

function rowTicks(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let ticked = 0, unticked = 0, doneTicked = 0, doneTotal = 0;
  const begins = [], ends = [];
  walkRows(lines, {
    top(line, index) {
      if (STATE_BEGIN.test(line)) begins.push(index);
      if (STATE_END.test(line)) ends.push(index);
    },
    row(line, index, { doneWhen }) {
      const row = CHECKBOX.exec(line);
      if (row && row[1] === ' ') unticked += 1;
      else if (row) ticked += 1;
      if (row && doneWhen) { doneTotal += 1; if (row[1] !== ' ') doneTicked += 1; }
    },
  });
  const merged = begins.length === 1 && ends.length === 1 && begins[0] < ends[0]
    ? lines.slice(begins[0] + 1, ends[0]).map(line => MERGED_ROW.exec(line)).filter(Boolean).map(match => Number(match[1]))
    : [];
  return { ticked, unticked, merged: [...new Set(merged)].sort((a, b) => a - b), done_when: { ticked: doneTicked, total: doneTotal } };
}

// What the DONE WHEN backfill reads and writes, over the same walk as rowTicks. It converts only a
// page with no DONE WHEN checkbox row (rowTicks counts none), so a page that already shows a Progress
// count keeps its text. A plain row is a top-level list item under a DONE WHEN heading, above any
// `**Not in scope:**` label line there and outside any generated block: `- `, `* ` or `+ ` (the
// marker kept) or `1. ` / `1) ` (any number, written as `- `), with 0 to 3 spaces before it and text
// after it. It becomes an unticked `[ ] ` row with its text unchanged. Never converted: a checkbox
// row (counted instead), a nested item (indented past the list's first item), a thematic break, an
// item whose text already starts like a checkbox (`[ ]`, `[x]`, `[]`), a numbered line other than 1
// that continues a paragraph (GitHub shows it as text), rows in fenced code, comments, generated
// blocks or ROWS sections, and every other line. Returns { heading, checkboxes, plain, body }:
// whether a DONE WHEN heading stands outside generated blocks, its checkbox rows, the plain rows
// ({ line, from, to }) and the page with them converted, line endings kept (the same text when there
// are none).
const PLAIN_BULLET = /^( {0,3})([-*+]) +(\S.*)$/;
const PLAIN_NUMBERED = /^( {0,3})(\d{1,9})[.)] +(\S.*)$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CHECKBOX_START = /^\[[ xX]?\]/;
const NOT_IN_SCOPE = /^ {0,3}\*\*Not in scope\b/i;
function doneWhenRows(body) {
  const text = String(body || '');
  const counted = rowTicks(text).done_when.total;
  const raw = text.split('\n');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let heading = false, checkboxes = 0, last = -2, previous = 'blank', listIndent = null, outOfScope = false;
  const plain = [];
  walkRows(lines, {
    top(line, index, generated) {
      const found = generated ? null : ROWS_HEADING.exec(line);
      if (found && /^DONE WHEN\b/i.test(found[2])) heading = true;
    },
    row(line, index, { doneWhen, generated }) {
      // A heading, fence or comment between two lines ends the list the walk was in.
      if (index !== last + 1) { previous = 'blank'; listIndent = null; outOfScope = false; }
      last = index;
      if (NOT_IN_SCOPE.test(line)) outOfScope = true;
      if (!doneWhen || generated || outOfScope) { previous = 'blank'; listIndent = null; return; }
      if (/^[ \t]*$/.test(line) || THEMATIC_BREAK.test(line)) { previous = 'blank'; return; }
      const item = CHECKBOX.exec(line) ? { indent: /^ */.exec(line)[0].length, checkbox: true } : null;
      const bullet = item ? null : PLAIN_BULLET.exec(line);
      const numbered = item || bullet ? null : PLAIN_NUMBERED.exec(line);
      const found = item || bullet || numbered;
      if (!found) {
        if (previous !== 'item') { previous = 'text'; listIndent = null; }
        return;
      }
      const indent = item ? item.indent : found[1].length;
      const nested = listIndent !== null && indent > listIndent;
      const continues = numbered && Number(numbered[2]) !== 1 && previous === 'text';
      if (continues) return;
      if (!nested) listIndent = indent;
      previous = 'item';
      if (item) { if (!nested) checkboxes += 1; return; }
      if (nested || CHECKBOX_START.test(found[3])) return;
      const to = bullet ? `${bullet[1]}${bullet[2]} [ ] ${bullet[3]}` : `${numbered[1]}- [ ] ${numbered[3]}`;
      plain.push({ line: index + 1, from: line, to });
      raw[index] = to + (raw[index].endsWith('\r') ? '\r' : '');
    },
  });
  if (counted) return { heading, checkboxes: counted, plain: [], body: text };
  return { heading, checkboxes, plain, body: plain.length ? raw.join('\n') : text };
}

module.exports = Object.freeze({ POLISH_CAP, DONE_WHEN, sectionOf, polishRows, uncheckedRows, rowTicks, doneWhenRows });
