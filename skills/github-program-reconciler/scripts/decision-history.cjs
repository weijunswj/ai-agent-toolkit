#!/usr/bin/env node
'use strict';

// Decision history for one programme child: the read G0 does before planning it. Reads the
// parent's comment trace and the child's comment trace separately (they never mix), groups each by
// comment tag, takes the latest comment per tag as live (an explicit SUPERSEDES= naming a record
// replaces it outright), and prints a short live-scope summary for the owner to confirm. Untagged
// comments are listed as "Other comments" for G0 to read; nothing is skipped silently.
//
// Read-only: it never writes to GitHub or the state store. The summary becomes the child's spec
// only after the owner confirms it; the controller then posts a comment tagged SCOPE-CONFIRMED on
// the child, and each correction as its own tagged comment (the latest per tag wins).
//
// Usage: node decision-history.cjs --repo <owner/name> --child <n> [--parent <n>]
//          [--record-prefix <prefix>] [--edits] [--full] [--max <n>] [--json]
//        node decision-history.cjs --repo <owner/name> --programme [--parent <n>] [...]
//        node decision-history.cjs --ledger <file> --child <n> --parent <n> [...]
//
// --parent and --record-prefix default to .github/toolkit-programme.json in the repository.
// --programme reads the parent and every sub-issue once, for the backfill when governance is first
// enabled; G0 never uses it. --ledger reads a toolkit.decision-ledger.v1 crawl instead of GitHub.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolveExecutable } = require('./resolve-executable.cjs');
const { OTHER_COMMENTS, splitTag, groupByTag } = require('./decision-tags.cjs');

const CONFIRMATION_TAG = 'SCOPE-CONFIRMED';
const INDEX_COMMENT_MARKER = '<!-- decision-trace-index -->';
const SUPERSEDES = /SUPERSEDES=([A-Za-z0-9._-]+)/g;
const RECORD_PREFIX = /^[A-Za-z0-9._-]{1,40}$/;
const DEFAULT_MAX = 10;

function isBot(comment) {
  const user = comment.user || {};
  return user.type === 'Bot' || /\[bot\]$/i.test(String(user.login || ''));
}

// The declared literal prefix followed by digits, for example INT-TK421-042; never a regex.
function recordId(text, prefix) {
  if (!prefix) return null;
  const source = String(text || '');
  for (let at = source.indexOf(prefix); at !== -1; at = source.indexOf(prefix, at + 1)) {
    const digits = /^\d+/.exec(source.slice(at + prefix.length))?.[0];
    if (digits) return `${prefix}${digits}`;
  }
  return null;
}

function supersededIds(text, prefix) {
  return [...String(text || '').matchAll(SUPERSEDES)].map(match => (prefix ? recordId(match[1], prefix) : match[1])).filter(Boolean);
}

// A comment's first heading or line as one short plain line, safe inside a Markdown link.
function summaryOf(text) {
  const first = String(text || '').split('\n').map(line => line.replace(/<!--.*?-->/g, '').replace(/[#*_`>|]/g, '').trim())
    .find(line => line && line !== '---') || 'comment';
  const plain = first.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ');
  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
}

function mentions(text) {
  return [...new Set([...String(text || '').matchAll(/(?:^|[^\w&/])#(\d+)\b/g)].map(match => Number(match[1])))];
}

// One trace entry per person comment. Bots and reconciler index comments are counted, not entries.
function entriesFromComments(issue, comments, { repo = '', prefix = null } = {}) {
  const counts = { comments: comments.length, bots: 0, index_comments: 0 };
  const entries = [];
  for (const comment of comments) {
    if (isBot(comment)) { counts.bots += 1; continue; }
    const body = String(comment.body || '');
    if (body.includes(INDEX_COMMENT_MARKER)) { counts.index_comments += 1; continue; }
    const { tag, text } = splitTag(body);
    entries.push({
      issue, id: String(comment.id), tag,
      url: comment.html_url || (repo ? `https://github.com/${repo}/issues/${issue}#issuecomment-${comment.id}` : `#issuecomment-${comment.id}`),
      created_at: String(comment.created_at || ''), date: String(comment.created_at || '').slice(0, 10) || 'undated',
      author: comment.user?.login || null, record: recordId(text, prefix), supersedes: supersededIds(text, prefix),
      summary: summaryOf(text), mentions: mentions(text), text
    });
  }
  return { entries, counts };
}

// Entries from a toolkit.decision-ledger.v1 crawl. The crawl predates comment tags, so its entries
// are untagged unless the ledger carries a `tag`; its keyword topics are kept only as hints.
function entriesFromLedger(ledger, issue) {
  if (ledger?.schema !== 'toolkit.decision-ledger.v1' || !Array.isArray(ledger.issues)) throw new Error('--ledger must be a toolkit.decision-ledger.v1 file');
  const found = ledger.issues.find(item => Number(item.issue) === Number(issue));
  if (!found) return { entries: [], counts: { comments: 0, bots: 0, index_comments: 0, missing: true } };
  const entries = (found.entries || []).filter(entry => entry.kind !== 'index').map(entry => ({
    issue, id: String(entry.comment_id), tag: entry.tag ? String(entry.tag).toUpperCase() : null,
    url: entry.url || `#issuecomment-${entry.comment_id}`, created_at: String(entry.created_at || ''),
    date: String(entry.created_at || entry.date || '').slice(0, 10) || 'undated', author: entry.author || null,
    record: entry.record_id || null, supersedes: [].concat(entry.supersedes || []).map(String),
    summary: summaryOf(entry.summary), mentions: mentions(entry.summary), text: String(entry.summary || ''), hint: entry.topic || null
  }));
  return { entries, counts: { comments: Number(found.comments ?? entries.length), bots: 0, index_comments: (found.index_comment_ids || []).length } };
}

// One issue's trace analysed on its own. `explicit` is every record some read entry names in
// SUPERSEDES= (records are global, so a child record can replace a parent record and back).
function analyseTrace(entries, explicit = new Set()) {
  const { tags, other } = groupByTag(entries);
  const confirmations = tags.get(CONFIRMATION_TAG) || [];
  tags.delete(CONFIRMATION_TAG);
  const confirmedAt = confirmations.length ? confirmations.at(-1).created_at : null;
  const byRecord = new Map(entries.filter(entry => entry.record).map(entry => [entry.record, entry]));
  const replacedBy = record => entries.find(entry => entry.supersedes.includes(record))?.record || null;
  const live = [];
  const replaced = [];
  for (const [tag, list] of tags) {
    const latest = list.at(-1);
    const latestReplaced = latest.record && explicit.has(latest.record);
    if (!latestReplaced) live.push({ ...latest, replaces: list.length - 1, confirmed: Boolean(confirmedAt && latest.created_at <= confirmedAt) });
    for (const entry of latestReplaced ? list : list.slice(0, -1)) {
      const isExplicit = Boolean(entry.record && explicit.has(entry.record));
      const basis = isExplicit ? 'explicit' : confirmedAt && latest.created_at <= confirmedAt ? 'confirmed' : 'inferred';
      replaced.push({ ...entry, tag, basis, by: isExplicit ? replacedBy(entry.record) : (latest.record || `comment ${latest.id}`) });
    }
  }
  // Untagged comments that name a tag after that tag's latest decision may change it: G0 reads them.
  const uncertain = [];
  for (const entry of other) {
    for (const decision of live) {
      if (entry.created_at > decision.created_at && new RegExp(`(^|[^A-Za-z0-9-])${decision.tag.replace(/[.]/g, '\\.')}($|[^A-Za-z0-9-])`, 'i').test(entry.text)) {
        uncertain.push({ entry, tag: decision.tag });
      }
    }
  }
  const otherReplaced = other.filter(entry => entry.record && explicit.has(entry.record));
  return {
    tags: tags.size, tagged: entries.length - other.length - confirmations.length, live, replaced,
    other: other.filter(entry => !otherReplaced.includes(entry)), other_replaced: otherReplaced, uncertain,
    untagged_records: other.filter(entry => entry.record && !otherReplaced.includes(entry)),
    confirmation: confirmations.length ? { at: confirmedAt, url: confirmations.at(-1).url } : null,
    records: byRecord.size
  };
}

function explicitSet(...lists) {
  return new Set(lists.flat().flatMap(entry => entry.supersedes));
}

// The history for one child: its own trace and the parent's, analysed separately.
function childHistory({ child, parent, childEntries, parentEntries }) {
  const explicit = explicitSet(childEntries.entries, parentEntries ? parentEntries.entries : []);
  const result = { child, parent, child_trace: { ...analyseTrace(childEntries.entries, explicit), counts: childEntries.counts } };
  if (parentEntries && parent !== child) {
    const trace = analyseTrace(parentEntries.entries, explicit);
    trace.mentions_child = trace.other.filter(entry => entry.mentions.includes(child));
    result.parent_trace = { ...trace, counts: parentEntries.counts };
  }
  return result;
}

function line(entry, extra = '') {
  const parts = [entry.date, entry.record || 'comment', `[${entry.summary}](${entry.url})`];
  if (entry.supersedes?.length) parts.push(...entry.supersedes.map(id => `SUPERSEDES=${id}`));
  return `- ${parts.join(' · ')}${extra}`;
}

function capped(items, max, render) {
  const shown = items.slice(0, max).map(render);
  if (items.length > max) shown.push(`- and ${items.length - max} more (run with --full to list them)`);
  return shown;
}

function coverage(number, trace) {
  const { counts } = trace;
  if (counts.missing) return `#${number}: not in the ledger, so not read`;
  return `#${number}: ${counts.comments} comments read (${trace.tagged} tagged in ${trace.tags} tag(s), ${trace.other.length + trace.other_replaced.length} other, ${counts.index_comments} index, ${counts.bots} bot)`;
}

function traceLines(number, trace, { max, full }) {
  const limit = full ? Infinity : max;
  const out = [];
  out.push(trace.confirmation
    ? `Owner confirmation on #${number}: ${trace.confirmation.at.slice(0, 10)} ([${CONFIRMATION_TAG}](${trace.confirmation.url})). Lines marked "new" came after it.`
    : `Owner confirmation on #${number}: none yet, so every live line below needs the owner's confirmation.`);
  out.push(`#${number} live decisions (latest per tag):`);
  if (!trace.live.length) out.push('- none');
  const live = [...trace.live].sort((a, b) => b.created_at.localeCompare(a.created_at));
  out.push(...capped(live, limit, entry => `${line(entry, entry.replaces ? ` · replaces ${entry.replaces} earlier` : '').replace('- ', `- ${entry.tag} · `)}${trace.confirmation && !entry.confirmed ? ' · new' : ''}`));
  const inferred = trace.replaced.filter(entry => entry.basis === 'inferred');
  if (trace.replaced.length) {
    out.push(`#${number} replaced: ${trace.replaced.length} (${trace.replaced.filter(e => e.basis === 'explicit').length} explicit, ${inferred.length} inferred, ${trace.replaced.filter(e => e.basis === 'confirmed').length} confirmed)`);
    if (full) out.push(...trace.replaced.map(entry => line(entry, ` · ${entry.tag} · superseded by ${entry.by} (${entry.basis})`)));
  }
  if (trace.uncertain.length) {
    out.push(`#${number} uncertain: untagged comments that name a tag after its latest decision (read before planning):`);
    out.push(...capped(trace.uncertain, limit, item => line(item.entry, ` · names ${item.tag}`)));
  }
  if (trace.mentions_child) {
    out.push(`#${number} other comments that mention the child: ${trace.mentions_child.length}`);
    out.push(...capped([...trace.mentions_child].reverse(), limit, entry => line(entry)));
  }
  const others = [...trace.other].reverse().filter(entry => !trace.mentions_child?.includes(entry));
  const records = others.filter(entry => entry.record);
  const plain = others.filter(entry => !entry.record);
  out.push(`#${number} ${OTHER_COMMENTS.toLowerCase()} (no tag): ${trace.other.length}${trace.other_replaced.length ? `, plus ${trace.other_replaced.length} replaced by SUPERSEDES=` : ''}`);
  if (records.length) {
    out.push(`#${number} untagged records, newest first (G0 reads them; the latest on a question wins):`);
    out.push(...capped(records, limit, entry => line(entry)));
  }
  if (plain.length) {
    out.push(`#${number} untagged comments without a record ID, newest first:`);
    out.push(...capped(plain, full ? Infinity : Math.min(max, 3), entry => line(entry)));
  }
  return out;
}

function renderSummary(history, options = {}) {
  const settings = { max: DEFAULT_MAX, full: false, ...options };
  const { child, parent } = history;
  const out = [`Decision history for #${child}${history.parent_trace ? ` (parent #${parent})` : ''}`];
  const traces = [[child, history.child_trace], history.parent_trace && [parent, history.parent_trace]].filter(Boolean);
  const missing = traces.some(([, trace]) => trace.counts.missing);
  out.push(`Read: ${traces.map(([number, trace]) => coverage(number, trace)).join('; ')}.${missing ? '' : ' Nothing skipped.'}`);
  if (history.body_edits) out.push(`#${child} body: ${history.body_edits}`);
  out.push('', ...traceLines(child, history.child_trace, settings));
  if (history.parent_trace) out.push('', ...traceLines(parent, history.parent_trace, settings));
  out.push('', 'Show the owner the live lines and the uncertain ones. The summary is the spec only after the owner confirms it.');
  return out.join('\n');
}

// Enablement backfill: one coverage line per issue and the parent's live decisions.
function renderProgramme(parent, traces, options = {}) {
  const out = [`Decision history backfill for programme #${parent}: ${traces.length} issue(s) read once.`];
  let comments = 0;
  for (const { number, trace } of traces) {
    comments += trace.counts.comments;
    out.push(`- ${coverage(number, trace)}; ${trace.live.length} live, ${trace.replaced.length} replaced, ${trace.confirmation ? `confirmed ${trace.confirmation.at.slice(0, 10)}` : 'not confirmed'}`);
  }
  const missing = traces.filter(item => item.trace.counts.missing).length;
  out.push(`Total: ${comments} comments, ${missing ? `${missing} issue(s) not in the ledger` : 'nothing skipped'}.`);
  const parentTrace = traces.find(item => item.number === parent)?.trace;
  if (parentTrace) out.push('', ...traceLines(parent, parentTrace, { max: DEFAULT_MAX, full: false, ...options }));
  out.push('', 'Each child gets its own decision history when G0 picks it up. Nothing here is a spec until the owner confirms it.');
  return out.join('\n');
}

// JSON output without the comment text itself: the links lead to it.
function toJson(value) {
  return JSON.stringify(value, (key, item) => (key === 'text' ? undefined : item), 2);
}

function gh(args) {
  const result = spawnSync(resolveExecutable('gh'), args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}

function readBinding(repo) {
  const file = JSON.parse(gh(['api', `repos/${repo}/contents/.github/toolkit-programme.json`]));
  return JSON.parse(Buffer.from(String(file.content || ''), 'base64').toString('utf8'));
}

function readComments(repo, issue) {
  return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issue}/comments?per_page=100`])).flat();
}

function readSubIssues(repo, issue, seen = new Set([issue])) {
  const found = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issue}/sub_issues?per_page=100`])).flat();
  for (const sub of found) {
    if (seen.has(sub.number)) continue;
    seen.add(sub.number);
    readSubIssues(repo, sub.number, seen);
  }
  return seen;
}

// Body revisions of the child through GraphQL. Reports what it could not read instead of failing.
function readBodyEdits(repo, issue) {
  const [owner, name] = repo.split('/');
  const query = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){lastEditedAt userContentEdits(first:1){totalCount}}}}';
  try {
    const data = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `n=${issue}`]));
    const found = data?.data?.repository?.issue;
    if (!found) return 'body revisions not readable (issue not returned)';
    const total = found.userContentEdits?.totalCount ?? 0;
    return total ? `${total} revision(s), last edited ${String(found.lastEditedAt || '').slice(0, 10)}; G0 reads the revision history when a live line depends on the body` : 'never edited';
  } catch (error) {
    return `body revisions not readable (${error.message.split('\n')[0].slice(0, 120)})`;
  }
}

function parseArgs(argv) {
  const args = { repo: '', child: null, parent: null, recordPrefix: null, ledger: '', programme: false, edits: false, full: false, max: DEFAULT_MAX, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = () => argv[++i] || '';
    if (argv[i] === '--repo') args.repo = value();
    else if (argv[i] === '--child') args.child = Number(value());
    else if (argv[i] === '--parent') args.parent = Number(value());
    else if (argv[i] === '--record-prefix') args.recordPrefix = value();
    else if (argv[i] === '--ledger') args.ledger = value();
    else if (argv[i] === '--programme') args.programme = true;
    else if (argv[i] === '--edits') args.edits = true;
    else if (argv[i] === '--full') args.full = true;
    else if (argv[i] === '--max') args.max = Number(value());
    else if (argv[i] === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  const usage = 'Usage: decision-history.cjs --repo <owner/name> (--child <n> | --programme) [--parent <n>] [--record-prefix <prefix>] [--edits] [--full] [--max <n>] [--json], or --ledger <file> --child <n> --parent <n>';
  if (args.repo && !/^[\w.-]+\/[\w.-]+$/.test(args.repo)) throw new Error(usage);
  if (!args.repo && !args.ledger) throw new Error(usage);
  if (args.programme === (args.child !== null)) throw new Error(usage);
  for (const key of ['child', 'parent']) if (args[key] !== null && !(Number.isInteger(args[key]) && args[key] > 0)) throw new Error(`--${key} must be an issue number`);
  if (args.ledger && args.parent === null) throw new Error('--ledger needs --parent');
  if (args.ledger && args.edits) throw new Error('--edits reads GitHub; it does not work with --ledger');
  if (args.recordPrefix !== null && !RECORD_PREFIX.test(args.recordPrefix)) throw new Error('--record-prefix must be 1-40 letters, digits, dots, underscores or hyphens');
  if (!Number.isInteger(args.max) || args.max <= 0) throw new Error('--max must be a positive integer');
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const ledger = args.ledger ? JSON.parse(fs.readFileSync(args.ledger, 'utf8')) : null;
  if ((args.parent === null || args.recordPrefix === null) && args.repo) {
    const binding = readBinding(args.repo);
    if (args.parent === null) args.parent = Number(binding.parent_issue);
    if (args.recordPrefix === null && binding.record_prefix) args.recordPrefix = binding.record_prefix;
  }
  const read = issue => (ledger ? entriesFromLedger(ledger, issue) : entriesFromComments(issue, readComments(args.repo, issue), { repo: args.repo, prefix: args.recordPrefix }));
  if (args.programme) {
    const numbers = ledger ? [args.parent, ...ledger.issues.map(item => Number(item.issue)).filter(n => n !== args.parent)] : [...readSubIssues(args.repo, args.parent)];
    const reads = numbers.map(number => ({ number, ...read(number) }));
    const explicit = explicitSet(...reads.map(item => item.entries));
    const traces = reads.map(({ number, entries, counts }) => ({ number, trace: { ...analyseTrace(entries, explicit), counts } }));
    process.stdout.write(`${args.json ? toJson({ parent: args.parent, traces }) : renderProgramme(args.parent, traces, args)}\n`);
    return 0;
  }
  const history = childHistory({ child: args.child, parent: args.parent, childEntries: read(args.child), parentEntries: args.parent !== args.child ? read(args.parent) : null });
  if (args.edits) history.body_edits = readBodyEdits(args.repo, args.child);
  process.stdout.write(`${args.json ? toJson(history) : renderSummary(history, args)}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 2; }
}

module.exports = Object.freeze({
  CONFIRMATION_TAG, entriesFromComments, entriesFromLedger, analyseTrace, childHistory, renderSummary, renderProgramme, summaryOf, parseArgs
});
