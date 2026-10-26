'use strict';

// Comment tags for decision traces. A comment carries a tag when its first line is the tag and its
// second line is exactly `---`, for example:
//
//   Codex host support
//   ---
//   <the comment>
//
// The tag is the topic: the task's name as the Programme Graph shows it, or a short subject for a
// programme-wide comment. It is 1-80 letters, digits, spaces, dots, underscores, hyphens, commas,
// apostrophes, ampersands, slashes or brackets, starting with a letter or digit, and is compared in
// upper case with runs of spaces as one, so `codex host support` and `Codex Host Support` are one
// tag. Leading blank lines and CRLF line endings are accepted. A comment without a tag belongs to
// "Other comments".
// Each tag is its own list: tags are never combined, and within one tag the latest comment wins.
//
// Pure functions only: no reads, no writes.

const OTHER_COMMENTS = 'Other comments';
const TAG = /^[A-Za-z0-9][A-Za-z0-9 ._,'&/()-]{0,79}$/;

function lines(body) {
  const all = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  let first = 0;
  while (first < all.length && !all[first].trim()) first += 1;
  return all.slice(first);
}

// The tag as written (spaces collapsed), or null when the comment has none.
function commentTagLabel(body) {
  const [head, rule] = lines(body);
  if (rule === undefined || rule.trim() !== '---') return null;
  const tag = head.trim().replace(/\s+/g, ' ');
  return TAG.test(tag) ? tag : null;
}

// The comment's tag in upper case, or null when it has none.
function commentTag(body) {
  const label = commentTagLabel(body);
  return label ? label.toUpperCase() : null;
}

// The tag and the comment text after the `---` line; untagged comments keep their whole text.
function splitTag(body) {
  const tag = commentTag(body);
  if (!tag) return { tag: null, text: String(body || '') };
  return { tag, text: lines(body).slice(2).join('\n') };
}

// Entries ({ id, created_at, ... }) in trace order: oldest first, ties broken by comment ID.
function byTime(left, right) {
  const at = String(left.created_at || '').localeCompare(String(right.created_at || ''));
  if (at) return at;
  const a = BigInt(String(left.id || 0).replace(/\D/g, '') || 0);
  const b = BigInt(String(right.id || 0).replace(/\D/g, '') || 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

// Entries grouped by tag (entry.tag, null for untagged), each list oldest first. Returns
// { tags: Map<tag, entries[]>, other: entries[] }, with tags in first-seen order.
function groupByTag(entries) {
  const tags = new Map();
  const other = [];
  for (const entry of [...entries].sort(byTime)) {
    if (!entry.tag) { other.push(entry); continue; }
    if (!tags.has(entry.tag)) tags.set(entry.tag, []);
    tags.get(entry.tag).push(entry);
  }
  return { tags, other };
}

module.exports = Object.freeze({ OTHER_COMMENTS, commentTag, commentTagLabel, splitTag, byTime, groupByTag });
