'use strict';

// The one reader of `Toolkit-G2:` review verdict comments, shared by the merge train finder
// (repo/scripts/toolkit-merge-train-finder.cjs) and the programme sweep's boarding read
// (programme-state.cjs boardingOf). A verdict is a pull request comment whose first line is exactly
// `Toolkit-G2: PASS <40-hex head> tier=LIGHT|NORMAL|RISKY` (or FAIL), written by an account that can
// write to the repository (author association OWNER, MEMBER or COLLABORATOR); every other comment is
// ignored. It loads nothing and reads nothing but its arguments.

const VERDICT = /^Toolkit-G2: (PASS|FAIL) ([0-9a-f]{40}) tier=(LIGHT|NORMAL|RISKY)[ \t]*$/;
const WRITERS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);

// The newest verdict comment for `head` from an account that can write here, or null:
// { verdict, tier, route, carry, link }. `route` is the comment's second line; `carry` is what
// `carryFloor(lines after the second)` makes of the rest (null without one).
function verdictFor(comments, head, { carryFloor = () => null } = {}) {
  const found = (Array.isArray(comments) ? comments : [])
    .filter(comment => comment && WRITERS.includes(comment.author_association))
    .map(comment => ({ comment, lines: String(comment.body || '').split(/\r?\n/) }))
    .map(({ comment, lines }) => ({ comment, route: lines[1] ?? null, carry: carryFloor(lines.slice(2)), match: VERDICT.exec(lines[0]) }))
    .filter(entry => entry.match && entry.match[2] === head)
    // An edited verdict counts from its edit.
    .sort((a, b) => Date.parse(a.comment.updated_at || a.comment.created_at) - Date.parse(b.comment.updated_at || b.comment.created_at));
  const last = found[found.length - 1];
  return last ? { verdict: last.match[1], tier: last.match[3], route: last.route, carry: last.carry, link: last.comment.html_url || `verdict for ${head}` } : null;
}

module.exports = Object.freeze({ VERDICT, WRITERS, verdictFor });
