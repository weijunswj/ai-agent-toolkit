#!/usr/bin/env node
'use strict';

// Decision-trace audit for a programme issue. The issue body is the canonical record: every
// non-bot comment must be reachable from it, either linked directly by fragment link
// (#issuecomment-<id>) or listed in an index comment that the body links (one hop). Fails on any
// unlinked comment, a SUPERSEDES= reference to an unknown record, or a body at or over the
// threshold (default 60,000 characters; GitHub's limit is 65,536).
//
// Read-only. --repair writes a proposed body (the missing lines added to the body's decision
// index) to a local file; publishing it is the caller's separately authorised step.
//
// Usage: node decision-trace-audit.cjs --repo <owner/name> --issue <n> [--record-pattern <regex>]
//          [--threshold <chars>] [--repair --out <file>]

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const DEFAULT_THRESHOLD = 60000;
const INDEX_COMMENT_MARKER = '<!-- decision-trace-index -->';
const INDEX_BEGIN = '<!-- decision-index:begin -->';
const INDEX_END = '<!-- decision-index:end -->';
const LINK = /#issuecomment-(\d+)/g;
const SUPERSEDES = /SUPERSEDES=([A-Za-z0-9._-]+)/g;

function linkedIds(text) { return new Set([...String(text || '').matchAll(LINK)].map(match => match[1])); }

function isBot(comment) {
  const user = comment.user || {};
  return user.type === 'Bot' || /\[bot\]$/i.test(String(user.login || ''));
}

function recordId(text, pattern) {
  if (!pattern) return null;
  return new RegExp(pattern).exec(String(text || ''))?.[0] || null;
}

// body: the issue body. comments: GitHub issue comments ({ id, user, body }).
function auditDecisionTraces({ body, comments, recordPattern = null, threshold = DEFAULT_THRESHOLD }) {
  const fromBody = linkedIds(body);
  const people = comments.filter(comment => !isBot(comment));
  const indexes = people.filter(comment => String(comment.body || '').includes(INDEX_COMMENT_MARKER));
  const linkedIndexes = indexes.filter(comment => fromBody.has(String(comment.id)));
  const reachable = new Set(fromBody);
  for (const index of linkedIndexes) for (const id of linkedIds(index.body)) reachable.add(id);
  const records = new Map(people.map(comment => [String(comment.id), recordId(comment.body, recordPattern)]));
  const knownIds = new Set([...records.values()].filter(Boolean));

  const unlinked = people.filter(comment => !reachable.has(String(comment.id)))
    .map(comment => ({ id: String(comment.id), record: records.get(String(comment.id)), index: indexes.includes(comment) }));
  const unknownSupersedes = recordPattern ? people.flatMap(comment => [...String(comment.body || '').matchAll(SUPERSEDES)]
    .map(match => match[1]).filter(id => !knownIds.has(id)).map(id => ({ id: String(comment.id), supersedes: id }))) : [];
  const unlabelled = recordPattern ? people.filter(comment => !indexes.includes(comment) && !records.get(String(comment.id))).map(comment => String(comment.id)) : [];
  const bodyLength = String(body || '').length;
  const overThreshold = bodyLength >= threshold;
  return {
    ok: !unlinked.length && !unknownSupersedes.length && !overThreshold,
    comments: people.length, linked: people.length - unlinked.length, unlinked, unknown_supersedes: unknownSupersedes,
    unlabelled, body_length: bodyLength, threshold, over_threshold: overThreshold,
    index_comments: linkedIndexes.map(comment => String(comment.id))
  };
}

// One index line per unlinked comment, in comment order.
function indexLines(unlinked) {
  return unlinked.map(entry => `- [${entry.record || `comment ${entry.id}`}](#issuecomment-${entry.id})`);
}

// The body with the missing lines added inside its decision index, creating a collapsed index at
// the end when the body has none. Never removes or reorders existing text.
function repairedBody(body, unlinked) {
  const lines = indexLines(unlinked);
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
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}

function fetchIssue(repo, issue) {
  const body = JSON.parse(gh(['api', `repos/${repo}/issues/${issue}`])).body || '';
  const pages = gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issue}/comments?per_page=100`]);
  return { body, comments: JSON.parse(pages).flat() };
}

function parseArgs(argv) {
  const args = { repo: '', issue: '', recordPattern: null, threshold: DEFAULT_THRESHOLD, repair: false, out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = () => argv[++i] || '';
    if (argv[i] === '--repo') args.repo = value();
    else if (argv[i] === '--issue') args.issue = value();
    else if (argv[i] === '--record-pattern') args.recordPattern = value();
    else if (argv[i] === '--threshold') args.threshold = Number(value());
    else if (argv[i] === '--repair') args.repair = true;
    else if (argv[i] === '--out') args.out = value();
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo) || !/^\d+$/.test(args.issue)) throw new Error('Usage: decision-trace-audit.cjs --repo <owner/name> --issue <n> [--record-pattern <regex>] [--threshold <chars>] [--repair --out <file>]');
  if (!Number.isInteger(args.threshold) || args.threshold <= 0) throw new Error('--threshold must be a positive integer');
  if (args.repair && !args.out) throw new Error('--repair needs --out <file>');
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { body, comments } = fetchIssue(args.repo, args.issue);
  const result = auditDecisionTraces({ body, comments, recordPattern: args.recordPattern, threshold: args.threshold });
  if (args.repair) {
    fs.writeFileSync(args.out, repairedBody(body, result.unlinked));
    result.repair_file = args.out;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 2; }
}

module.exports = Object.freeze({ DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, INDEX_BEGIN, INDEX_END, auditDecisionTraces, indexLines, repairedBody, parseArgs });
