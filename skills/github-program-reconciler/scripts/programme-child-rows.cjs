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
const ROWS_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const CHECKBOX = /^ {0,3}[-*+] \[([ xX])\] /;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const STATE_BEGIN = /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v\d+ .*-->$/;
const STATE_END = /^<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->$/;
const MERGED_ROW = /^\|.*\|#(\d+)\|MERGED(?: · [^|]*)?\|\[[0-9a-f]{7,40}\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[0-9a-f]{40}\)\|$/;
function rowTicks(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let fence = null, comment = false, section = 0, ticked = 0, unticked = 0;
  const begins = [], ends = [];
  lines.forEach((line, index) => {
    if (fence) {
      if (new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
      return;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      return;
    }
    if (STATE_BEGIN.test(line)) begins.push(index);
    if (STATE_END.test(line)) ends.push(index);
    const open = FENCE_OPEN.exec(line);
    if (open) { fence = open[1]; return; }
    if (/^ {0,3}<!--/.test(line)) {
      comment = !line.slice(line.indexOf('<!--') + 4).includes('-->');
      return;
    }
    const heading = ROWS_HEADING.exec(line);
    if (heading) {
      if (section && heading[1].length <= section) section = 0;
      if (/^(DONE WHEN|ROWS)\b/i.test(heading[2])) section = heading[1].length;
      return;
    }
    const row = section ? CHECKBOX.exec(line) : null;
    if (row && row[1] === ' ') unticked += 1;
    else if (row) ticked += 1;
  });
  const merged = begins.length === 1 && ends.length === 1 && begins[0] < ends[0]
    ? lines.slice(begins[0] + 1, ends[0]).map(line => MERGED_ROW.exec(line)).filter(Boolean).map(match => Number(match[1]))
    : [];
  return { ticked, unticked, merged: [...new Set(merged)].sort((a, b) => a - b) };
}

module.exports = Object.freeze({ POLISH_CAP, DONE_WHEN, sectionOf, polishRows, uncheckedRows, rowTicks });
