#!/usr/bin/env node
'use strict';

// Decision-trace audit for a programme issue. The issue body is the canonical record: every
// decision comment (one with a tag on its first line or a record ID) must be reachable from it,
// either linked directly (<issue URL>#issuecomment-<id>, or the bare fragment) or listed in an index comment that
// the body links (one hop). Other comments need no index entry: they are listed as unlinked, never
// a failure. Fails on any unlinked decision comment, a SUPERSEDES= reference to an unknown record,
// a superseded record that is not marked "superseded by" or "replaced by" (in its own comment, or
// right after a link to it in the body or an index comment), or a body at or over the threshold (default 60,000 characters; GitHub's limit is 65,536).
//
// Read-only. --repair writes a proposed body (the missing lines added to the body's decision
// index, in the shape "- <date> · <record> · [<summary>](<issue URL>#issuecomment-<id>)", plus
// "SUPERSEDES=" and "superseded by" where they apply) to a local file; publishing it is the
// caller's separately authorised step. The reconcile pass runs the same audit and reports gaps.
//
// Usage: node decision-trace-audit.cjs --repo <owner/name> --issue <n> [--record-prefix <prefix>]
//          [--threshold <chars>] [--repair --out <file> [--ledger <file>]]
//
// --ledger takes a decision ledger (toolkit.decision-ledger.v1) and adds each comment's topic tag to
// its repair line.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolveExecutable } = require('./resolve-executable.cjs');
const { commentTag, commentTagLabel, splitTag } = require('./decision-tags.cjs');

const DEFAULT_THRESHOLD = 60000;
const INDEX_COMMENT_MARKER = '<!-- decision-trace-index -->';
const INDEX_BEGIN = '<!-- decision-index:begin -->';
const INDEX_END = '<!-- decision-index:end -->';
const LINK = /#issuecomment-(\d+)/g;
const SUPERSEDES = /SUPERSEDES=([A-Za-z0-9._-]+)/g;

function linkedIds(text) { return new Set([...String(text || '').matchAll(LINK)].map(match => match[1])); }

// Comment IDs whose link is marked as replaced: "superseded by" or "replaced by" between the link
// and the next comment link on the same line (or the line's end).
const REPLACED_MARK = /(?:superseded|replaced) by/i;
function markedIds(text) {
  const marked = new Set();
  for (const line of String(text || '').split('\n')) {
    const links = [...line.matchAll(LINK)];
    links.forEach((match, at) => {
      const stop = at + 1 < links.length ? links[at + 1].index : line.length;
      if (REPLACED_MARK.test(line.slice(match.index + match[0].length, stop))) marked.add(match[1]);
    });
  }
  return marked;
}

function isBot(comment) {
  const user = comment.user || {};
  return user.type === 'Bot' || /\[bot\]$/i.test(String(user.login || ''));
}

// A record ID is the declared literal prefix followed by digits, for example INT-TK421-042. The
// prefix is matched as plain text, never compiled into a regular expression.
const RECORD_PREFIX = /^[A-Za-z0-9._-]{1,40}$/;
function recordId(text, prefix) {
  if (!prefix) return null;
  const source = String(text || '');
  for (let at = source.indexOf(prefix); at !== -1; at = source.indexOf(prefix, at + 1)) {
    const digits = /^\d+/.exec(source.slice(at + prefix.length))?.[0];
    if (digits) return `${prefix}${digits}`;
  }
  return null;
}

// Record IDs per comment and which record replaced which, from SUPERSEDES= lines naming a known record.
function recordFacts(people, recordPrefix) {
  const records = new Map(people.map(comment => [String(comment.id), recordId(comment.body, recordPrefix)]));
  const commentOf = new Map();
  for (const [id, record] of records) if (record && !commentOf.has(record)) commentOf.set(record, id);
  const supersededBy = new Map();
  const supersededById = new Map();
  const supersedes = new Map();
  if (recordPrefix) {
    for (const comment of people) {
      for (const match of String(comment.body || '').matchAll(SUPERSEDES)) {
        const old = recordId(match[1], recordPrefix);
        if (!old || !commentOf.has(old)) continue;
        const by = records.get(String(comment.id)) || `comment ${comment.id}`;
        if (!supersededBy.has(old)) { supersededBy.set(old, by); supersededById.set(old, String(comment.id)); }
        supersedes.set(String(comment.id), [...(supersedes.get(String(comment.id)) || []), old]);
      }
    }
  }
  return { records, commentOf, supersededBy, supersededById, supersedes };
}

// The tag line and its `---` are not part of the summary.
function entryFor(comment, facts, index) {
  const record = facts.records.get(String(comment.id));
  const { tag, text } = splitTag(comment.body);
  return {
    id: String(comment.id), record, index, tag, tag_label: commentTagLabel(comment.body),
    date: String(comment.created_at || '').slice(0, 10) || null, summary: commentSummary(text),
    supersedes: facts.supersedes.get(String(comment.id)) || [], superseded_by: facts.supersededBy.get(record) || null,
    superseded_by_id: facts.supersededById.get(record) || null,
  };
}

// The trace an issue body carries: its index comments (each a link, with the tag it holds) and, as
// index entries in comment order, every comment none of them lists, each with its tag (null for
// "Other comments"). `marks` names superseded records that an index comment lists without
// "superseded by", with the tag of the record's comment.
function traceEntries(comments, recordPrefix = null) {
  const people = comments.filter(comment => !isBot(comment));
  const indexes = people.filter(comment => String(comment.body || '').includes(INDEX_COMMENT_MARKER));
  const covered = new Set();
  const markedInIndex = new Set();
  for (const index of indexes) {
    for (const id of linkedIds(index.body)) covered.add(id);
    for (const id of markedIds(index.body)) markedInIndex.add(id);
  }
  const facts = recordFacts(people, recordPrefix);
  const entries = people.filter(comment => !indexes.includes(comment) && !covered.has(String(comment.id))).map(comment => entryFor(comment, facts, false));
  const tagOf = id => commentTag(people.find(comment => String(comment.id) === id)?.body);
  const marks = [...facts.supersededBy].map(([record, by]) => ({ id: facts.commentOf.get(record), record, superseded_by: by, superseded_by_id: facts.supersededById.get(record) || null, tag: tagOf(facts.commentOf.get(record)) }))
    .filter(entry => covered.has(entry.id) && !markedInIndex.has(entry.id)
      && !/superseded by/i.test(String(people.find(comment => String(comment.id) === entry.id)?.body || '')));
  return { indexes: indexes.map(comment => ({ id: String(comment.id), tag: commentTag(comment.body), tag_label: commentTagLabel(comment.body), date: String(comment.created_at || '').slice(0, 10) || null })), entries, marks };
}

// body: the issue body. comments: GitHub issue comments ({ id, user, body }).
function auditDecisionTraces({ body, comments, recordPrefix = null, threshold = DEFAULT_THRESHOLD }) {
  if (recordPrefix !== null && !RECORD_PREFIX.test(recordPrefix)) throw new Error('--record-prefix must be 1-40 letters, digits, dots, underscores or hyphens');
  const fromBody = linkedIds(body);
  const people = comments.filter(comment => !isBot(comment));
  const indexes = people.filter(comment => String(comment.body || '').includes(INDEX_COMMENT_MARKER));
  const linkedIndexes = indexes.filter(comment => fromBody.has(String(comment.id)));
  const reachable = new Set(fromBody);
  for (const index of linkedIndexes) for (const id of linkedIds(index.body)) reachable.add(id);
  const facts = recordFacts(people, recordPrefix);
  const { records, commentOf, supersededBy } = facts;
  const knownIds = new Set([...records.values()].filter(Boolean));

  const marked = markedIds([String(body || ''), ...linkedIndexes.map(index => String(index.body || ''))].join('\n'));
  const supersededUnmarked = [...supersededBy].map(([record, by]) => ({ id: commentOf.get(record), record, superseded_by: by }))
    .filter(entry => {
      const own = people.find(comment => String(comment.id) === entry.id);
      if (/superseded by/i.test(String(own?.body || ''))) return false;
      return !marked.has(entry.id);
    });
  const unlinked = people.filter(comment => !reachable.has(String(comment.id))).map(comment => entryFor(comment, facts, indexes.includes(comment)));
  const unlinkedDecisions = unlinked.filter(entry => entry.tag || entry.record);
  // Only a SUPERSEDES= value that starts with a record ID (the prefix plus digits) is a reference to
  // check, whatever follows it (a full stop, "-draft", "_x"); prose such as "SUPERSEDES=the
  // auto-refresh allowance" is left alone.
  const unknownSupersedes = recordPrefix ? people.flatMap(comment => [...String(comment.body || '').matchAll(SUPERSEDES)]
    .filter(match => match[1].startsWith(recordPrefix)).map(match => recordId(match[1], recordPrefix))
    .filter(id => id && !knownIds.has(id))
    .map(id => ({ id: String(comment.id), supersedes: id }))) : [];
  const unlabelled = recordPrefix ? people.filter(comment => !indexes.includes(comment) && !records.get(String(comment.id))).map(comment => String(comment.id)) : [];
  const bodyLength = String(body || '').length;
  const overThreshold = bodyLength >= threshold;
  return {
    ok: !unlinkedDecisions.length && !unknownSupersedes.length && !supersededUnmarked.length && !overThreshold,
    comments: people.length, linked: people.length - unlinked.length, unlinked, unlinked_decisions: unlinkedDecisions, unknown_supersedes: unknownSupersedes,
    superseded_unmarked: supersededUnmarked,
    unlabelled, body_length: bodyLength, threshold, over_threshold: overThreshold,
    index_comments: linkedIndexes.map(comment => String(comment.id))
  };
}

// A comment's first heading or line as one short plain line for an index entry. HTML comments go
// first (across lines, closed or not), then every angle bracket, so no summary can open a comment
// or tag that hides the rest of the index.
function commentSummary(text) {
  const visible = String(text || '').replace(/<!--[\s\S]*?(?:--!?>|$)/g, '');
  const first = visible.split('\n').map(line => line.replace(/[<>#*_`]/g, '').trim()).find(Boolean) || 'comment';
  const plain = first.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain;
}

// The link to one comment: the issue's full URL plus the comment anchor when `base` (the issue URL)
// is known, else a bare fragment. A bare fragment only works when the comment is already on the
// page: GitHub folds the middle of a long timeline and the mobile app opens the issue itself.
function commentLink(base, id) { return `${base || ''}#issuecomment-${id}`; }

// The issue URL that comment links start from.
function issueUrl(repo, issue) { return repo && issue ? `https://github.com/${repo}/issues/${issue}` : ''; }

// One index line per entry, in comment order, linking the comment:
// "- <date> · <record> · [<summary>](<issue URL>#issuecomment-<id>) · <topic>", then SUPERSEDES= and
// "superseded by". `topics` maps a comment ID to its topic (from a decision ledger); no topic, no part.
function indexLines(entries, topics = new Map(), base = '') {
  return entries.map(entry => [
    `- ${entry.date || 'undated'}`,
    entry.record || 'comment',
    `[${entry.summary || `comment ${entry.id}`}](${commentLink(base, entry.id)})`,
    ...(topics.get(String(entry.id)) ? [topics.get(String(entry.id))] : []),
    ...(entry.supersedes || []).map(record => `SUPERSEDES=${record}`),
    ...(entry.superseded_by ? [`superseded by ${entry.superseded_by}`] : []),
  ].join(' · '));
}

// The body with the missing lines added inside its decision index, creating a collapsed index at
// the end when the body has none. Never removes or reorders existing text.
// A marking line for a superseded record that is linked but not marked.
function markLines(marks, base = '') {
  return marks.map(entry => `- superseded record · ${entry.record} · [${entry.record}](${commentLink(base, entry.id)}) · superseded by ${entry.superseded_by}`);
}

// Superseded records that are already linked but not marked get a marking line of their own.
function repairedBody(body, unlinked, supersededUnmarked = [], topics = new Map(), base = '') {
  const missing = new Set(unlinked.map(entry => entry.id));
  const lines = [...indexLines(unlinked, topics, base), ...markLines(supersededUnmarked.filter(entry => !missing.has(entry.id)), base)];
  if (!lines.length) return body;
  const text = String(body || '');
  const end = text.indexOf(INDEX_END);
  if (text.indexOf(INDEX_BEGIN) !== -1 && end !== -1) {
    const before = text.slice(0, end).replace(/\s*$/, '');
    return `${before}\n${lines.join('\n')}\n${text.slice(end)}`;
  }
  return `${text.replace(/\s*$/, '')}\n\n<details><summary>Decision index</summary>\n\n${INDEX_BEGIN}\n${lines.join('\n')}\n${INDEX_END}\n\n</details>\n`;
}

function gh(args) {
  const result = spawnSync(resolveExecutable('gh'), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}

function fetchIssue(repo, issue) {
  const body = JSON.parse(gh(['api', `repos/${repo}/issues/${issue}`])).body || '';
  const pages = gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issue}/comments?per_page=100`]);
  return { body, comments: JSON.parse(pages).flat() };
}

function parseArgs(argv) {
  const args = { repo: '', issue: '', recordPrefix: null, threshold: DEFAULT_THRESHOLD, repair: false, out: '', ledger: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = () => argv[++i] || '';
    if (argv[i] === '--repo') args.repo = value();
    else if (argv[i] === '--issue') args.issue = value();
    else if (argv[i] === '--record-prefix') args.recordPrefix = value();
    else if (argv[i] === '--threshold') args.threshold = Number(value());
    else if (argv[i] === '--repair') args.repair = true;
    else if (argv[i] === '--out') args.out = value();
    else if (argv[i] === '--ledger') args.ledger = value();
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo) || !/^\d+$/.test(args.issue)) throw new Error('Usage: decision-trace-audit.cjs --repo <owner/name> --issue <n> [--record-prefix <prefix>] [--threshold <chars>] [--repair --out <file> [--ledger <file>]]');
  if (args.recordPrefix !== null && !RECORD_PREFIX.test(args.recordPrefix)) throw new Error('--record-prefix must be 1-40 letters, digits, dots, underscores or hyphens');
  if (!Number.isInteger(args.threshold) || args.threshold <= 0) throw new Error('--threshold must be a positive integer');
  if (args.repair && !args.out) throw new Error('--repair needs --out <file>');
  if (args.ledger && !args.repair) throw new Error('--ledger is used only with --repair');
  return args;
}

// Topic per comment ID from a decision ledger (schema toolkit.decision-ledger.v1). Topics are
// keyword tags; a missing or empty topic leaves the line without one.
function ledgerTopics(ledger) {
  if (ledger?.schema !== 'toolkit.decision-ledger.v1' || !Array.isArray(ledger.issues)) throw new Error('--ledger must be a toolkit.decision-ledger.v1 file');
  const topics = new Map();
  for (const issue of ledger.issues) {
    for (const entry of Array.isArray(issue.entries) ? issue.entries : []) {
      const topic = String(entry.topic || '').replace(/[\r\n|[\]·]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (entry.comment_id && topic) topics.set(String(entry.comment_id), topic);
    }
  }
  return topics;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { body, comments } = fetchIssue(args.repo, args.issue);
  const result = auditDecisionTraces({ body, comments, recordPrefix: args.recordPrefix, threshold: args.threshold });
  if (args.repair) {
    const topics = args.ledger ? ledgerTopics(JSON.parse(fs.readFileSync(args.ledger, 'utf8').replace(/^\uFEFF/, ''))) : new Map();
    fs.writeFileSync(args.out, repairedBody(body, result.unlinked, result.superseded_unmarked, topics, issueUrl(args.repo, args.issue)));
    result.repair_file = args.out;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 2; }
}

module.exports = Object.freeze({ DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, INDEX_BEGIN, INDEX_END, auditDecisionTraces, commentSummary, commentLink, markedIds, issueUrl, indexLines, markLines, traceEntries, ledgerTopics, repairedBody, parseArgs });
