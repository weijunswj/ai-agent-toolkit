'use strict';

// Prevent closing an issue while any native descendant remains open. This module is also
// shipped with the copyable skill; transport and policy are explicit constructor inputs.
const REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const { performance } = require('node:perf_hooks');
const KEYWORD = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b';
const TARGET = '(?:https://github\\.com/[a-z0-9_.-]+/[a-z0-9_.-]+/issues/[1-9][0-9]*(?:#[a-z0-9_-]+)?|(?:[a-z0-9_.-]+/[a-z0-9_.-]+)?#[1-9][0-9]*)(?![a-z0-9_/#-])';
const MARKDOWN = `\\[[^\\]\\r\\n]*\\]\\([ \\t]*(${TARGET})[ \\t]*\\)`;
const REFERENCE = `(?:${MARKDOWN}|(${TARGET}))`;

function closingReferences(text, repository) {
  if (typeof text !== 'string' || !REPOSITORY.test(repository)) throw new Error('Invalid closing-reference input.');
  if (text.length > 1024 * 1024) throw new Error('Closing-reference text exceeds the read bound.');
  let words = 0;
  for (const ignored of text.matchAll(new RegExp(KEYWORD, 'gi'))) {
    if (++words > 1000) throw new Error('Too many closing words to inspect.');
  }
  const lines = [0];
  for (let offset = 0; offset < text.length; offset += 1) if (text[offset] === '\n') lines.push(offset + 1);
  const lineAt = offset => {
    let lo = 0; let hi = lines.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid] <= offset) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const result = [];
  const add = (target, offset, pattern) => {
    if (result.length >= 1000) throw new Error('Too many closing targets to inspect.');
    const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/i.exec(target);
    const short = /^(?:([^#]+))?#(\d+)/.exec(target);
    const number = Number((url || short)[2]);
    if (!Number.isSafeInteger(number)) throw new Error('Invalid issue number.');
    result.push({ repository: (url?.[1] || short?.[1] || repository).toLowerCase(), number,
      offset, line: lineAt(offset), pattern });
  };
  // GitHub's documented short forms, with defensive URL/Markdown matching. Lists continue
  // only across explicit list separators, never arbitrary intervening prose.
  const adjacent = new RegExp(`${KEYWORD}[ \\t]*(?::[ \\t]*)?(${REFERENCE}(?:[ \\t]*(?:,|and\\b|&)[ \\t]*${REFERENCE})*)`, 'gi');
  for (const match of text.matchAll(adjacent)) {
    for (const ref of match[1].matchAll(new RegExp(REFERENCE, 'gi'))) add(ref[1] || ref[2], match.index + match[0].indexOf(match[1]) + ref.index, 'closing-keyword');
  }
  // Incident defence, not a claim about independently verified GitHub grammar.
  const incident = new RegExp(`\\b(?:closed|resolved)\\b[ \\t]*(?::[ \\t]*)?\\(see[ \\t]+${REFERENCE}[ \\t]*\\)`, 'gi');
  for (const match of text.matchAll(incident)) add(match[1] || match[2], match.index, 'incident-record-link');
  return result;
}

// The UAT a task's generated programme STATE block records as still owed by the owner, or null.
// Only the block's own `- UAT: <state>; review:` line counts; text elsewhere in the body does not.
// A hand-made block can only add a refusal, never remove one.
const STATE_BLOCK = /<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v\d+[^\r\n]*?-->([\s\S]*?)<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->/g;
const OWED_UAT = /^- UAT: (PENDING|UAT_PARTIAL_REQUIRED|UAT_FULL_REQUIRED)\b[^\r\n]*; review: /m;
function owedUat(body) {
  if (typeof body !== 'string') return null;
  for (const block of body.matchAll(STATE_BLOCK)) { const owed = OWED_UAT.exec(block[1]); if (owed) return owed[1]; }
  return null;
}

const allowed = extra => ({ status: 'allowed', ...extra });
const unknown = reason => ({ status: 'unknown', reason });
class IssueClosureGuard {
  // `uatState`, when given, reads a PR body's UAT verdict (NOT_REQUIRED, OWNER_TEST_NEEDED, PASSED or
  // invalid); with it, closing words are also refused for a task that a merged PR still waiting on
  // the owner's test references. Without it that check is skipped (a copy of the skill alone).
  constructor({ transport, repository, maxRequests = 500, maxPages = 50, deadlineMs = 30000, deadline, now = () => performance.now(), uatState = null }) {
    if (!REPOSITORY.test(repository)) throw new Error('Invalid repository.');
    Object.assign(this, { transport, repository: repository.toLowerCase(), maxRequests, maxPages, deadlineMs, deadline, now, uatState });
  }

  // Merged PRs in the same repository that reference the task and still say UAT: OWNER_TEST_NEEDED.
  // The task stays open until the owner's OK turns that line into UAT: PASSED, even when the PR only
  // said Refs and the task's own page has not recorded the owed test yet.
  ownerTestPrs(repository, number, budget) {
    if (typeof this.uatState !== 'function') return [];
    const events = this.pages(`repos/${repository}/issues/${number}/timeline`, budget);
    const found = new Set();
    for (const event of events) {
      if (event?.event !== 'cross-referenced') continue;
      const source = event.source?.issue;
      if (!source?.pull_request?.merged_at || !Number.isSafeInteger(source.number)) continue;
      const from = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\//.exec(source.repository_url ? `${source.repository_url}/` : '')?.[1]?.toLowerCase();
      if (from !== repository.toLowerCase()) continue;
      if (this.uatState(typeof source.body === 'string' ? source.body : '') === 'OWNER_TEST_NEEDED') found.add(source.number);
    }
    return [...found].sort((a, b) => a - b);
  }

  budget() { return { requests: 0, deadline: Math.min(this.deadline ?? Infinity, this.now() + this.deadlineMs) }; }
  get(apiPath, budget, { missing = false } = {}) {
    if (++budget.requests > this.maxRequests || this.now() >= budget.deadline) throw new Error('Issue closure reads exceeded their bound or invocation deadline.');
    let response;
    try { response = this.transport.request('GET', apiPath, undefined, { timeoutMs: Math.max(1, Math.ceil(budget.deadline - this.now())) }); }
    catch (error) {
      // Report only the operation and a safe failure category, never transport output.
      const timeout = error?.code === 'ETIMEDOUT' || /ETIMEDOUT|timed?\s*out|timeout/i.test(error?.message || '');
      const category = error?.code === 'GH_AUTH' ? 'gh is not signed in; run gh auth login' : error?.code === 'GH_MISSING' || error?.code === 'EXECUTABLE_NOT_FOUND' ? 'gh is unavailable; run setup toolkit, then gh auth login' : 'gh transport unavailable';
      throw new Error(`GET ${apiPath} failed: ${timeout ? 'timeout' : category}.`);
    }
    if (this.now() > budget.deadline) throw new Error(`GET ${apiPath} failed: timeout (closure read deadline).`);
    if (missing && [404, 410].includes(response?.status)) return null;
    if (response?.status !== 200) throw new Error(`GET ${apiPath} failed: ${Number.isInteger(response?.status) ? `HTTP ${response.status}` : 'missing HTTP status'}.`);
    return response.json;
  }
  pages(apiPath, budget) {
    const all = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const rows = this.get(`${apiPath}?per_page=100&page=${page}`, budget);
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('Malformed GitHub page.');
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw new Error('GitHub pagination was incomplete.');
  }
  tree(repository, number, budget = this.budget(), path = new Set(), { full = false, resolved } = {}) {
    if (!REPOSITORY.test(repository) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue target.');
    const key = `${repository.toLowerCase()}#${number}`;
    if (path.has(key) || path.size > 8) throw new Error('Native issue tree is cyclic or too deep.');
    const next = new Set([...path, key]);
    const issue = resolved || this.get(`repos/${repository}/issues/${number}`, budget);
    if (issue?.number !== number || !['open', 'closed'].includes(issue.state) || issue.pull_request) throw new Error('Malformed issue state.');
    const children = this.pages(`repos/${repository}/issues/${number}/sub_issues`, budget);
    if (Number.isInteger(issue.sub_issues_summary?.total) && issue.sub_issues_summary.total > children.length) throw new Error('Native child pages disagree with the reported total.');
    const seen = new Set();
    const descendants = [];
    for (const child of children) {
      if (!Number.isSafeInteger(child?.number) || !['open', 'closed'].includes(child.state)) throw new Error('Malformed native child state.');
      const target = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(child.url || '');
      if (!target || !REPOSITORY.test(target[1]) || Number(target[2]) !== child.number) throw new Error('Native child identity unavailable.');
      const childKey = `${target[1].toLowerCase()}#${child.number}`;
      if (next.has(childKey)) throw new Error('Native issue tree is cyclic.');
      if (seen.has(childKey)) throw new Error('Duplicate native child across pages.');
      seen.add(childKey);
      if (!full && child.sub_issues_summary?.total === 0) {
        descendants.push({ repository: target[1].toLowerCase(), number: child.number, state: child.state });
        continue;
      }
      const nested = this.tree(target[1], child.number, budget, next, { full });
      // A changed state between the list and detail cannot support a close.
      if (nested.issue.state !== child.state) throw new Error('Native child changed during the read.');
      descendants.push({ repository: target[1].toLowerCase(), number: child.number, state: nested.issue.state }, ...nested.descendants);
    }
    return { issue, children, descendants };
  }
  assertClosable(number, repository = this.repository, budget = this.budget(), options = {}) {
    try {
      const tree = this.tree(repository, number, budget, new Set(), options);
      const open = tree.descendants.filter(child => child.state === 'open');
      return open.length ? { status: 'refused', reason: `Issue ${repository}#${number} has open native descendants. Keep it open and use Refs for parent links.`, open, tree } : allowed({ tree });
    } catch (error) { return unknown(`Native child state is incomplete or changed. ${error.message} Retry after GitHub can be read completely.`); }
  }
  checkTexts(texts, budget = this.budget(), { sources = [], prRead = false } = {}) {
    try {
      if (!Array.isArray(texts) || texts.reduce((length, text) => length + (typeof text === 'string' ? text.length : Infinity), 0) > 1024 * 1024) throw new Error('PR text exceeds the total read bound.');
      const references = texts.flatMap((text, i) => closingReferences(text, this.repository).map(ref => ({ ...ref, source: sources[i] || `text ${i + 1}` })));
      const targets = new Map();
      for (const ref of references) targets.set(`${ref.repository}#${ref.number}`, ref);
      let incomplete;
      for (const target of targets.values()) {
        let result;
        try {
          const issue = this.get(`repos/${target.repository}/issues/${target.number}`, budget, { missing: prRead && target.repository === this.repository });
          if (!issue || issue.number === target.number && issue.pull_request) continue;
          const owed = issue.state === 'open' ? owedUat(issue.body) : null;
          const waiting = !owed && issue.state === 'open' ? this.ownerTestPrs(target.repository, target.number, budget) : [];
          result = owed ? { status: 'refused', reason: `Issue ${target.repository}#${target.number} records UAT ${owed}: the owner's test is still owed. Keep it open and use Refs until the controller records UAT PASSED.` }
            : waiting.length ? { status: 'refused', reason: `Issue ${target.repository}#${target.number} is referenced by merged PR ${waiting.map(pr => `#${pr}`).join(', ')}, whose UAT line is still OWNER_TEST_NEEDED: the owner's test is still owed. Keep it open and use Refs until the owner's OK makes that line UAT: PASSED.` }
            : this.assertClosable(target.number, target.repository, budget, { resolved: issue });
        } catch (error) { result = unknown(`Closing target could not be read. ${error.message} Use Refs or retry when GitHub is readable.`); }
        const location = `${target.source}, line ${target.line}, ${target.pattern}, target ${target.repository}#${target.number}: `;
        if (result.status === 'refused') return { ...result, reason: location + result.reason };
        if (result.status === 'unknown') incomplete = { ...result, reason: location + result.reason };
      }
      if (incomplete) return incomplete;
      return allowed({ references });
    } catch { return unknown('PR text could not be inspected. Provide explicit title and body text or files.'); }
  }
  pullRequest(number, budget) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing or invalid PR number.');
    const pr = this.get(`repos/${this.repository}/pulls/${number}`, budget);
    if (pr?.number !== number || typeof pr.title !== 'string' || typeof pr.body !== 'string' && pr.body !== null || !/^[a-f0-9]{40}$/.test(pr.head?.sha || '') || !Number.isSafeInteger(pr.commits)) throw new Error('Malformed PR metadata.');
    return pr;
  }
  checkEdit(number, { title, body } = {}) {
    try {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing or invalid PR number.');
      const texts = []; const sources = [];
      if (title !== undefined) { texts.push(title); sources.push('title'); }
      if (body !== undefined) { texts.push(body); sources.push('body'); }
      // No retained text/commit reads. A closing reference first proves the PR exists.
      const references = texts.flatMap(text => closingReferences(text, this.repository));
      const budget = this.budget();
      if (references.length) this.pullRequest(number, budget);
      return this.checkTexts(texts, budget, { sources, prRead: references.length > 0 });
    } catch (error) { return unknown(`PR edit could not be inspected. ${error.message}`); }
  }
  checkPullRequest(number, { head = null, title, body, mergeTexts = [] } = {}) {
    try {
      const budget = this.budget();
      const before = this.pullRequest(number, budget);
      if (before.commits > 250) return unknown('PRs above the 250-commit inspection limit are unsupported; split the PR before retrying.');
      if (head && (!/^[a-f0-9]{7,40}$/i.test(head) || !before.head.sha.toLowerCase().startsWith(head.toLowerCase()))) return unknown('The requested PR head changed. Read the current head and retry.');
      const commits = this.pages(`repos/${this.repository}/pulls/${number}/commits`, budget);
      if (commits.length !== before.commits || commits.some(commit => typeof commit?.commit?.message !== 'string')) throw new Error('PR commits incomplete.');
      const result = this.checkTexts([title ?? before.title, body ?? before.body ?? '', ...commits.map(commit => commit.commit.message), ...mergeTexts], budget,
        { sources: ['title', 'body', ...commits.map((commit, i) => `commit ${commit.sha || i + 1}`), ...mergeTexts.map((text, i) => `merge override ${i + 1}`)], prRead: true });
      if (result.status !== 'allowed') return result;
      const after = this.pullRequest(number, budget);
      if (JSON.stringify([before.head.sha, before.title, before.body, before.commits]) !== JSON.stringify([after.head.sha, after.title, after.body, after.commits])) return unknown('PR head or text changed during inspection. Read it again and retry.');
      return { ...result, pr: after };
    } catch (error) { return unknown(`PR metadata or commits could not be read completely. ${error.message} Retry with a current explicit PR and head.`); }
  }
}
module.exports = { closingReferences, owedUat, IssueClosureGuard };
