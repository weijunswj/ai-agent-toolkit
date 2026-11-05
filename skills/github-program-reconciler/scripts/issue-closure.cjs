'use strict';

// Prevent closing an issue while any native descendant remains open. This module is also
// shipped with the copyable skill; transport and policy are explicit constructor inputs.
const REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const KEYWORD = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b';
const TARGET = '(?:https://github\\.com/[a-z0-9_.-]+/[a-z0-9_.-]+/issues/[1-9][0-9]*(?:#[a-z0-9_-]+)?|(?:[a-z0-9_.-]+/[a-z0-9_.-]+)?#[1-9][0-9]*)';
const MARKDOWN = `\\[[^\\]\\r\\n]*\\]\\(\\s*(${TARGET})\\s*\\)`;
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
  const adjacent = new RegExp(`${KEYWORD}\\s*:?\\s*(${REFERENCE}(?:\\s*(?:,|;|and|&)\\s*${REFERENCE})*)`, 'gi');
  for (const match of text.matchAll(adjacent)) {
    for (const ref of match[1].matchAll(new RegExp(REFERENCE, 'gi'))) add(ref[1] || ref[2], match.index + match[0].indexOf(match[1]) + ref.index, 'closing-keyword');
  }
  // Incident defence, not a claim about independently verified GitHub grammar.
  const incident = new RegExp(`\\b(?:closed|resolved)\\b\\s*:?\\s*\\(see\\s+${REFERENCE}\\s*\\)`, 'gi');
  for (const match of text.matchAll(incident)) add(match[1] || match[2], match.index, 'incident-record-link');
  return result;
}

const allowed = extra => ({ status: 'allowed', ...extra });
const unknown = reason => ({ status: 'unknown', reason });
class IssueClosureGuard {
  constructor({ transport, repository, parentIssue = null, maxRequests = 500, maxPages = 50, deadlineMs = 30000, now = () => Date.now() }) {
    if (!REPOSITORY.test(repository)) throw new Error('Invalid repository.');
    Object.assign(this, { transport, repository: repository.toLowerCase(), parentIssue, maxRequests, maxPages, deadlineMs, now });
  }

  budget() { return { requests: 0, deadline: this.now() + this.deadlineMs }; }
  get(apiPath, budget) {
    if (++budget.requests > this.maxRequests || this.now() > budget.deadline) throw new Error('Issue closure reads exceeded their bound.');
    let response;
    try { response = this.transport.request('GET', apiPath); }
    catch (error) {
      // Report only the operation and a safe failure category, never transport output.
      const timeout = error?.code === 'ETIMEDOUT' || /ETIMEDOUT|timed?\s*out|timeout/i.test(error?.message || '');
      throw new Error(`GET ${apiPath} failed: ${timeout ? 'timeout' : 'transport unavailable'}.`);
    }
    if (this.now() > budget.deadline) throw new Error(`GET ${apiPath} failed: timeout (closure read deadline).`);
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
  tree(repository, number, budget = this.budget(), path = new Set()) {
    if (!REPOSITORY.test(repository) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue target.');
    const key = `${repository.toLowerCase()}#${number}`;
    if (path.has(key) || path.size > 8) throw new Error('Native issue tree is cyclic or too deep.');
    const next = new Set([...path, key]);
    const issue = this.get(`repos/${repository}/issues/${number}`, budget);
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
      if (child.sub_issues_summary?.total === 0) {
        descendants.push({ repository: target[1].toLowerCase(), number: child.number, state: child.state });
        continue;
      }
      const nested = this.tree(target[1], child.number, budget, next);
      // A changed state between the list and detail cannot support a close.
      if (nested.issue.state !== child.state) throw new Error('Native child changed during the read.');
      descendants.push({ repository: target[1].toLowerCase(), number: child.number, state: nested.issue.state }, ...nested.descendants);
    }
    return { issue, children, descendants };
  }
  assertClosable(number, repository = this.repository, budget = this.budget()) {
    try {
      const tree = this.tree(repository, number, budget);
      const open = tree.descendants.filter(child => child.state === 'open');
      return open.length ? { status: 'refused', reason: `Issue ${repository}#${number} has open native descendants. Keep it open and use Refs for parent links.`, open, tree } : allowed({ tree });
    } catch (error) { return unknown(`Native child state is incomplete or changed. ${error.message} Retry after GitHub can be read completely.`); }
  }
  checkTexts(texts, budget = this.budget()) {
    try {
      if (!Array.isArray(texts) || texts.reduce((length, text) => length + (typeof text === 'string' ? text.length : Infinity), 0) > 1024 * 1024) throw new Error('PR text exceeds the total read bound.');
      const references = texts.flatMap(text => closingReferences(text, this.repository));
      const targets = new Map();
      for (const ref of references) targets.set(`${ref.repository}#${ref.number}`, ref);
      let incomplete;
      for (const target of targets.values()) {
        const result = this.assertClosable(target.number, target.repository, budget);
        if (result.status === 'refused') return result;
        if (result.status === 'unknown') incomplete = result;
      }
      if (incomplete) return incomplete;
      return allowed({ references });
    } catch { return unknown('PR text could not be inspected. Provide explicit title and body text or files.'); }
  }
  pullRequest(number, budget) {
    const pr = this.get(`repos/${this.repository}/pulls/${number}`, budget);
    if (pr?.number !== number || typeof pr.title !== 'string' || typeof pr.body !== 'string' && pr.body !== null || !/^[a-f0-9]{40}$/.test(pr.head?.sha || '') || !Number.isSafeInteger(pr.commits)) throw new Error('Malformed PR metadata.');
    return pr;
  }
  checkPullRequest(number, { head = null, title, body, mergeTexts = [] } = {}) {
    try {
      const budget = this.budget();
      const before = this.pullRequest(number, budget);
      if (head && head !== before.head.sha) return unknown('The requested PR head changed. Read the current head and retry.');
      const commits = this.pages(`repos/${this.repository}/pulls/${number}/commits`, budget);
      if (commits.length !== before.commits || commits.some(commit => typeof commit?.commit?.message !== 'string')) throw new Error('PR commits incomplete.');
      const result = this.checkTexts([title ?? before.title, body ?? before.body ?? '', ...commits.map(commit => commit.commit.message), ...mergeTexts], budget);
      if (result.status !== 'allowed') return result;
      const after = this.pullRequest(number, budget);
      if (JSON.stringify([before.head.sha, before.title, before.body, before.commits, before.updated_at]) !== JSON.stringify([after.head.sha, after.title, after.body, after.commits, after.updated_at])) return unknown('PR head or text changed during inspection. Read it again and retry.');
      return result;
    } catch (error) { return unknown(`PR metadata or commits could not be read completely. ${error.message} Retry with a current explicit PR and head.`); }
  }
}
module.exports = { closingReferences, IssueClosureGuard };
