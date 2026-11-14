#!/usr/bin/env node
'use strict';

// Decision-trace audit for a programme issue. The issue body is the canonical record: every
// decision comment (one with a tag on its first line or a record ID) must be reachable from it,
// either linked directly (<issue URL>#issuecomment-<id>, or the bare fragment) or listed in an index comment that
// the body links, optionally through a directory (at most two index hops). Other comments need no index entry: they are listed as unlinked, never
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
const { commentTag, commentTagLabel, splitTag, isArchiveComment } = require('./decision-tags.cjs');

const DEFAULT_THRESHOLD = 60000;
const INDEX_COMMENT_MARKER = '<!-- decision-trace-index -->';
const DIRECTORY_COMMENT_MARKER = '<!-- decision-trace-directory -->';
const MAX_INDEX_DEPTH = 2;
const MAX_INDEX_COMMENTS = 1024;
const INDEX_BEGIN = '<!-- decision-index:begin -->';
const INDEX_END = '<!-- decision-index:end -->';
const LINK = /#issuecomment-(\d+)/g;
const SUPERSEDES = /SUPERSEDES=([A-Za-z0-9._-]+)/g;

function linkedIds(text) { return new Set([...String(text || '').matchAll(LINK)].map(match => match[1])); }

// Generated indexes have strict edges. Hand-made indexes retain their original one-hop meaning:
// foreign and missing references are prose, and references to other indexes are not traversed.
// Only local links can supply coverage. Never follow a link with another read.
function indexGraph({ body = '', comments, repository = '', issue = null, all = false }) {
  const people = comments.filter(comment => !isBot(comment));
  const byId = new Map(people.map(comment => [String(comment.id), comment]));
  const indexes = people.filter(comment => !isArchiveComment(comment.body) && String(comment.body || '').includes(INDEX_COMMENT_MARKER));
  const indexIds = new Set(indexes.map(comment => String(comment.id)));
  const strictIds = new Set(indexes.filter(comment => String(comment.body).includes('programme-trace intent=')
    || String(comment.body).includes(DIRECTORY_COMMENT_MARKER)).map(comment => String(comment.id)));
  const base = issueUrl(repository, issue);
  const errors = [];
  const links = text => {
    const source = String(text || '');
    return [...source.matchAll(LINK)].map(match => {
      let start = match.index;
      // Look back only at actual anchors. A greedy optional URL prefix rescans long prose once
      // per character; this bounded scan also refuses oversized or malformed link targets.
      while (start > 0 && match.index - start < 2048 && !/[\s()<>\[\]]/.test(source[start - 1])) start -= 1;
      const target = source.slice(start, match.index + match[0].length);
      // GitHub owner and repository names are case-insensitive, as the binding comparison is.
      return { id: match[1], local: target === match[0] || !base || target.toLowerCase() === commentLink(base, match[1]).toLowerCase() };
    });
  };
  const children = new Set();
  const localLinks = new Map(indexes.map(index => [String(index.id), links(index.body).filter(link => link.local && byId.has(link.id)
    && !(String(index.body).includes(DIRECTORY_COMMENT_MARKER) && String(byId.get(link.id).body).includes(DIRECTORY_COMMENT_MARKER)))]));
  for (const index of indexes.filter(index => strictIds.has(String(index.id)))) {
    for (const link of localLinks.get(String(index.id))) if (indexIds.has(link.id)) children.add(link.id);
  }
  const roots = indexes.filter(comment => !children.has(String(comment.id)));
  const reachable = new Set();
  const visited = new Map();
  const linkedIndexes = [];
  let strictVisits = 0;
  const visit = (id, depth, path) => {
    if (path.has(id)) { errors.push({ code: 'INDEX_CYCLE', id }); return; }
    if (depth > MAX_INDEX_DEPTH) { errors.push({ code: 'INDEX_DEPTH', id }); return; }
    if ((visited.get(id) || 0) >= depth) return;
    if (!visited.has(id) && strictIds.has(id) && strictVisits >= MAX_INDEX_COMMENTS) { errors.push({ code: 'INDEX_LIMIT', id }); return; }
    const firstVisit = !visited.has(id);
    if (firstVisit && strictIds.has(id)) strictVisits += 1;
    visited.set(id, depth);
    const index = byId.get(id);
    if (firstVisit) linkedIndexes.push(index);
    const nextPath = new Set([...path, id]);
    const directory = String(index.body).includes(DIRECTORY_COMMENT_MARKER);
    const strict = strictIds.has(id);
    for (const link of links(index.body)) {
      if (!link.local) { if (strict) errors.push({ code: 'INDEX_UNRELATED', id, target: link.id }); continue; }
      if (!byId.has(link.id)) { if (strict) errors.push({ code: 'INDEX_MISSING', id, target: link.id }); continue; }
      if (directory && String(byId.get(link.id).body).includes(DIRECTORY_COMMENT_MARKER)) { errors.push({ code: 'INDEX_UNRELATED', id, target: link.id }); continue; }
      reachable.add(link.id);
      if (strict && indexIds.has(link.id)) visit(link.id, depth + 1, nextPath);
    }
  };
  if (all) {
    // Include disconnected components too: a cycle has no root, and must never hide comments.
    for (const index of [...roots, ...indexes]) {
      const id = String(index.id);
      if (!visited.has(id)) { reachable.add(id); visit(id, 1, new Set()); }
    }
  } else {
    for (const link of links(body)) {
      if (!link.local) continue;
      reachable.add(link.id);
      if (indexIds.has(link.id)) visit(link.id, 1, new Set());
    }
    // A missing body link labelled as an index cannot masquerade as a missing ordinary note.
    for (const match of String(body || '').matchAll(/\[(?:list|topic directory) \d+\]\(([^)]*#issuecomment-(\d+))\)/g)) {
      if (!indexIds.has(match[2])) errors.push({ code: byId.has(match[2]) ? 'INDEX_UNRELATED' : 'INDEX_MISSING', id: match[2] });
      else if (base && match[1].toLowerCase() !== commentLink(base, match[2]).toLowerCase() && match[1] !== `#issuecomment-${match[2]}`) errors.push({ code: 'INDEX_UNRELATED', id: match[2] });
    }
  }
  return { indexes, roots, reachable, linkedIndexes, errors, localLinks, strictIds };
}

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
  if (!prefix || isArchiveComment(text)) return null;
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
      if (isArchiveComment(comment.body)) continue;
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
// A dead or foreign link in a generated index covers nothing, so the comments it no longer reaches
// return to the body trace and the page keeps redrawing; the audit still reports the link. Only a
// structural fault (a cycle, too many hops or too many pages) stops the redraw.
const PROJECTION_TOLERATED = new Set(['INDEX_MISSING', 'INDEX_UNRELATED']);

// Plain recovery text for an index fault, shared by the audit finding and any hold.
function indexRecoveryText(codes) {
  const steps = [];
  if (codes.some(code => PROJECTION_TOLERATED.has(code))) steps.push('A linked comment was deleted or points to another issue, repository or directory; the page still redraws and lists the comments it no longer reaches in the body; to clear this, remove that link from the named index comment.');
  if (codes.some(code => code === 'INDEX_CYCLE' || code === 'INDEX_DEPTH')) steps.push('An index comment links in a loop or too deep; edit or delete the named index comment to remove the loop or extra hop, then run again.');
  if (codes.includes('INDEX_LIMIT')) steps.push(`Too many generated index pages: the limit is ${MAX_INDEX_COMMENTS} per issue; compact or delete obsolete index comments to stay within it, then run again. If only the planned new pages would exceed it, shorten retained body prose to avoid adding pages.`);
  return steps.join(' ');
}

function indexErrorText(errors) {
  const list = errors.map(entry => `${entry.code} ${entry.id}${entry.target ? ` -> ${entry.target}` : ''}`).join(', ');
  return `Invalid comment index: ${list}. ${indexRecoveryText(errors.map(entry => entry.code))}`;
}

function traceEntries(comments, recordPrefix = null, repository = '', issue = null) {
  const people = comments.filter(comment => !isBot(comment));
  const graph = indexGraph({ comments, repository, issue, all: true });
  const blocking = graph.errors.filter(entry => !PROJECTION_TOLERATED.has(entry.code));
  if (blocking.length) {
    const error = new Error(indexErrorText(blocking));
    error.code = 'TRACE_INDEX_INVALID';
    throw error;
  }
  const { indexes } = graph;
  const covered = new Set();
  const markedInIndex = new Set();
  for (const index of indexes) {
    const local = new Set(graph.localLinks.get(String(index.id)).map(link => link.id));
    for (const id of local) covered.add(id);
    for (const id of markedIds(index.body)) if (local.has(id)) markedInIndex.add(id);
  }
  const facts = recordFacts(people, recordPrefix);
  const entries = people.filter(comment => !indexes.includes(comment) && !covered.has(String(comment.id))).map(comment => entryFor(comment, facts, false));
  const bodyOf = id => people.find(comment => String(comment.id) === id)?.body;
  const marks = [...facts.supersededBy].map(([record, by]) => ({ id: facts.commentOf.get(record), record, superseded_by: by, superseded_by_id: facts.supersededById.get(record) || null,
    tag: commentTag(bodyOf(facts.commentOf.get(record))), tag_label: commentTagLabel(bodyOf(facts.commentOf.get(record))) }))
    .filter(entry => covered.has(entry.id) && !markedInIndex.has(entry.id)
      && !/superseded by/i.test(String(people.find(comment => String(comment.id) === entry.id)?.body || '')));
  const entry = comment => ({ id: String(comment.id), tag: commentTag(comment.body), tag_label: commentTagLabel(comment.body), date: String(comment.created_at || '').slice(0, 10) || null });
  const ids = new Set(indexes.map(comment => String(comment.id)));
  return { strict_count: graph.strictIds.size, directories: graph.roots.filter(comment => String(comment.body).includes(DIRECTORY_COMMENT_MARKER)).map(entry),
    indexes: graph.roots.filter(comment => !String(comment.body).includes(DIRECTORY_COMMENT_MARKER)).map(comment => ({ ...entry(comment), nested: graph.strictIds.has(String(comment.id)) && graph.localLinks.get(String(comment.id)).some(link => ids.has(link.id)) })), entries, marks };
}

// body: the issue body. comments: GitHub issue comments ({ id, user, body }).
function auditDecisionTraces({ body, comments, recordPrefix = null, threshold = DEFAULT_THRESHOLD, repository = '', issue = null }) {
  if (recordPrefix !== null && !RECORD_PREFIX.test(recordPrefix)) throw new Error('--record-prefix must be 1-40 letters, digits, dots, underscores or hyphens');
  const people = comments.filter(comment => !isBot(comment));
  const { indexes, linkedIndexes, reachable, errors } = indexGraph({ body, comments, repository, issue });
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
  const unknownSupersedes = recordPrefix ? people.filter(comment => !isArchiveComment(comment.body)).flatMap(comment => [...String(comment.body || '').matchAll(SUPERSEDES)]
    .filter(match => match[1].startsWith(recordPrefix)).map(match => recordId(match[1], recordPrefix))
    .filter(id => id && !knownIds.has(id))
    .map(id => ({ id: String(comment.id), supersedes: id }))) : [];
  const unlabelled = recordPrefix ? people.filter(comment => !indexes.includes(comment) && !records.get(String(comment.id))).map(comment => String(comment.id)) : [];
  const bodyLength = String(body || '').length;
  const overThreshold = bodyLength >= threshold;
  return {
    ok: !errors.length && !unlinkedDecisions.length && !unknownSupersedes.length && !supersededUnmarked.length && !overThreshold,
    comments: people.length, linked: people.length - unlinked.length, unlinked, unlinked_decisions: unlinkedDecisions, unknown_supersedes: unknownSupersedes,
    superseded_unmarked: supersededUnmarked,
    unlabelled, body_length: bodyLength, threshold, over_threshold: overThreshold,
    index_comments: linkedIndexes.map(comment => String(comment.id)), index_errors: errors
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
  // Numbered pages instead of --paginate, which some proxies refuse (it follows numeric-id links).
  const comments = [];
  for (let page = 1; ; page += 1) {
    const rows = JSON.parse(gh(['api', `repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`]));
    comments.push(...rows);
    if (rows.length < 100) break;
  }
  return { body, comments };
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
  const result = auditDecisionTraces({ body, comments, recordPrefix: args.recordPrefix, threshold: args.threshold, repository: args.repo, issue: args.issue });
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

module.exports = Object.freeze({ indexErrorText, indexRecoveryText, DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER, MAX_INDEX_DEPTH, MAX_INDEX_COMMENTS, INDEX_BEGIN, INDEX_END, auditDecisionTraces, commentSummary, commentLink, markedIds, issueUrl, indexLines, markLines, traceEntries, ledgerTopics, repairedBody, parseArgs, isBot });
