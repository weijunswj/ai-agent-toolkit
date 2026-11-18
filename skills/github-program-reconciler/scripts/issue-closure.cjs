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
// Only the block's own UAT counts; text elsewhere in the body does not. The renderer
// (programme-state.cjs renderChildBlockBody) writes it as one segment of the hidden task status
// line, `<!-- Task status: <status> · UAT: <state> -->` (the PR GRAPH shows it as `UAT owed`);
// pages an older Toolkit drew still carry it in the STATUS line, `... · UAT: <state> · Review: ...`,
// or as the legacy `- UAT: <state>; review:` line. Any owed UAT segment in the block refuses, so a hand-made block or a spoofed segment can
// only add a refusal, never remove one.
const STATE_BLOCK = /<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v\d+[^\r\n]*?-->([\s\S]*?)<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->/g;
const OWED_STATES = '(PENDING|UAT_PARTIAL_REQUIRED|UAT_FULL_REQUIRED)\\b';
const OWED_UAT = [new RegExp(`(?:^| · )UAT: ${OWED_STATES}`, 'm'), new RegExp(`^- UAT: ${OWED_STATES}[^\\r\\n]*; review: `, 'm')];
function owedUat(body) {
  if (typeof body !== 'string') return null;
  for (const block of body.matchAll(STATE_BLOCK)) for (const pattern of OWED_UAT) { const owed = pattern.exec(block[1]); if (owed) return owed[1]; }
  return null;
}

// A merge train pull request carries its members: it merges each member's reviewed head, Refs
// every member's task and holds one UAT line for the whole train (the strictest member's). Its body
// is recognised by the `## Merge train` heading and member table that toolkit-merge-train.cjs body
// writes. Returns the member PR numbers, sorted, or null for any other body.
const TRAIN_HEADING = /^## Merge train[ \t]*$/m;
const TRAIN_TABLE = /^\| Member \| Reviewed head \|/m;
const TRAIN_ROW = /^\| #([1-9][0-9]*) \| `([0-9a-f]{40})` \|/gm;
// The member rows of a train body ({ pr, head }), or null for any other body.
function mergeTrainRows(body) {
  if (typeof body !== 'string' || body.length > 1024 * 1024 || !TRAIN_HEADING.test(body) || !TRAIN_TABLE.test(body)) return null;
  const rows = new Map();
  for (const match of body.matchAll(TRAIN_ROW)) if (Number.isSafeInteger(Number(match[1])) && !rows.has(Number(match[1]))) rows.set(Number(match[1]), { pr: Number(match[1]), head: match[2] });
  return rows.size ? [...rows.values()].sort((a, b) => a.pr - b.pr) : null;
}
function mergeTrainMembers(body) {
  const rows = mergeTrainRows(body);
  return rows ? rows.map(row => row.pr) : null;
}
// A table alone proves nothing. A member was carried by a merged train only when GitHub marked it
// merged with the train (an indirect merge lands seconds after it), and by an open train only while
// that member is open at the exact head the table names.
const TRAIN_MERGE_WINDOW_MS = 10 * 60 * 1000;
function trainCarried(train, member, head) {
  if (!train || !member) return false;
  if (train.state === 'MERGED') {
    const from = Date.parse(train.merged_at); const at = Date.parse(member.merged_at);
    return member.state === 'MERGED' && Number.isFinite(from) && Number.isFinite(at) && at >= from && at - from <= TRAIN_MERGE_WINDOW_MS;
  }
  return train.state === 'OPEN' && member.state === 'OPEN' && typeof member.head === 'string' && member.head.toLowerCase() === head;
}
// The members a train's own OWNER_TEST_NEEDED line names as owing the owner's test.
function trainOwing(body) {
  const line = /^UAT: OWNER_TEST_NEEDED \(([^\r\n]*)\)[ \t]*$/m.exec(String(body || ''));
  return new Set(line ? [...line[1].matchAll(/#([1-9][0-9]*)/g)].map(match => Number(match[1])) : []);
}

// The train's own commits (trainShape). GitHub lists at most 250 commits for a pull request and 300
// files for a commit; a train or commit beyond that cannot be proven.
const SHA40 = /^[0-9a-f]{40}$/;
const MAX_TRAIN_COMMITS = 250;
const MAX_COMMIT_FILES = 300;
const lower = value => (typeof value === 'string' ? value.toLowerCase() : '');
function parentShas(parents) {
  if (!Array.isArray(parents)) return null;
  const shas = parents.map(parent => lower(parent?.sha));
  return shas.every(sha => SHA40.test(sha)) ? shas : null;
}
// The head an eject revert names, when it carries both trailers toolkit-merge-train.cjs eject writes.
function ejectHead(message) {
  const head = /^Train-Eject-Head: ([0-9a-f]{40})[ \t]*$/m.exec(message);
  return head && /^Train-Eject-PR: #[1-9][0-9]*[ \t]*$/m.test(message) ? head[1] : null;
}
// The removed and added lines of a unified diff patch as GitHub returns it, by hunk; only lines
// inside a hunk count, and "\ No newline at end of file" is not a line.
function patchChanges(patch) {
  const hunks = [];
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('@@')) hunks.push({ removed: [], added: [] });
    else if (hunks.length && line.startsWith('-')) hunks[hunks.length - 1].removed.push(line.slice(1).replace(/\r$/, ''));
    else if (hunks.length && line.startsWith('+')) hunks[hunks.length - 1].added.push(line.slice(1).replace(/\r$/, ''));
  }
  return { removed: hunks.flatMap(hunk => hunk.removed), added: hunks.flatMap(hunk => hunk.added), hunks };
}
const sameLines = (a, b) => a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const allowed = extra => ({ status: 'allowed', ...extra });
const unknown = reason => ({ status: 'unknown', reason });
class IssueClosureGuard {
  // `uatState`, when given, reads a PR body's UAT verdict (NOT_REQUIRED, OWNER_TEST_NEEDED, PASSED or
  // invalid); with it, closing words are also refused for a task that a merged PR still waiting on
  // the owner's test references. Without it that check is skipped (a copy of the skill alone).
  // `trainBump`, when given, reads the files of a merge train's bump commit (GitHub's commit `files`)
  // and returns true only when they change nothing but version stamps and changelog notes; without
  // it no train with a bump commit releases a task.
  constructor({ transport, repository, maxRequests = 500, maxPages = 50, deadlineMs = 30000, deadline, now = () => performance.now(), uatState = null, trainBump = null }) {
    if (!REPOSITORY.test(repository)) throw new Error('Invalid repository.');
    Object.assign(this, { transport, repository: repository.toLowerCase(), maxRequests, maxPages, deadlineMs, deadline, now, uatState, trainBump });
  }

  // Merged PRs in the same repository that reference the task and still say UAT: OWNER_TEST_NEEDED.
  // The task stays open until the owner's OK turns that line into UAT: PASSED, even when the PR only
  // said Refs and the task's own page has not recorded the owed test yet.
  ownerTestPrs(repository, number, budget) {
    if (typeof this.uatState !== 'function') return [];
    const events = this.pages(`repos/${repository}/issues/${number}/timeline`, budget);
    const merged = new Map();
    for (const event of events) {
      if (event?.event !== 'cross-referenced') continue;
      const source = event.source?.issue;
      if (!source?.pull_request?.merged_at || !Number.isSafeInteger(source.number)) continue;
      const from = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\//.exec(source.repository_url ? `${source.repository_url}/` : '')?.[1]?.toLowerCase();
      if (from !== repository.toLowerCase()) continue;
      merged.set(source.number, { body: typeof source.body === 'string' ? source.body : '', merged_at: source.pull_request.merged_at });
    }
    const found = new Set();
    const asMerged = entry => entry && { state: 'MERGED', merged_at: entry.merged_at };
    for (const [pr, { body, merged_at }] of merged) {
      if (this.uatState(body) !== 'OWNER_TEST_NEEDED') continue;
      // A merge train's UAT line is its strictest member's. It releases this task only when every
      // member it references here was carried by the train, owes nothing by its own strict UAT line
      // (NOT_REQUIRED or PASSED) and is not named by the train's line as owing the owner's test.
      const rows = mergeTrainRows(body);
      if (rows) {
        const owing = trainOwing(body);
        const train = { state: 'MERGED', merged_at };
        const backing = rows.filter(row => row.pr !== pr && merged.has(row.pr));
        if (backing.length && backing.every(row => trainCarried(train, asMerged(merged.get(row.pr)), row.head) && !owing.has(row.pr)
          && ['NOT_REQUIRED', 'PASSED'].includes(this.uatState(merged.get(row.pr).body)))
          && this.carriedHeads(repository, pr, rows, backing, budget)) continue;
      }
      found.add(pr);
    }
    return [...found].sort((a, b) => a - b);
  }

  // A table and merge times can still be pasted. Each member must have merged at the head its row
  // names (one PR read each), and the train's own commits must prove it is a train (trainShape).
  carriedHeads(repository, train, rows, backing, budget) {
    for (const row of backing) if (!this.mergedAt(repository, row, budget)) return false;
    return this.trainShape(repository, train, rows, backing, budget);
  }
  // Whether the row's pull request exists and GitHub shows it merged at the head the row names.
  mergedAt(repository, row, budget) {
    const member = this.get(`repos/${repository}/pulls/${row.pr}`, budget, { missing: true });
    return member?.merged === true && String(member.head?.sha || '').toLowerCase() === row.head;
  }

  // A merged train is a train only when its first-parent commits, from its head back to the main it
  // landed on, are each one of: a member merge (its second parent is a row's reviewed head, the row
  // names another pull request GitHub shows merged at that head, a row boards at most once, and every
  // member the release relies on boards), a catch-up merge (its second
  // parent is already in that main), an eject revert (Train-Eject-Head and Train-Eject-PR trailers)
  // that exactly undoes an earlier merge of that head,
  // or a commit the `trainBump` reader accepts as changing only version stamps and changelog notes
  // after the last merge (the bump, and eject's revert of a bump and fresh bump).
  // Every other commit, including a merge of a sibling branch that never reached main, keeps the hold.
  // GitHub reads only, since the guard has no checkout; a failed read throws (an unknown, never a release).
  trainShape(repository, train, rows, backing, budget) {
    const pull = this.get(`repos/${repository}/pulls/${train}`, budget);
    const head = lower(pull?.head?.sha); const landed = lower(pull?.merge_commit_sha);
    if (pull?.merged !== true || !SHA40.test(head) || !SHA40.test(landed) || !Number.isSafeInteger(pull.commits)) throw new Error('Merge train metadata unreadable.');
    if (pull.commits > MAX_TRAIN_COMMITS) throw new Error(`Merge train has more than ${MAX_TRAIN_COMMITS} commits, which GitHub cannot list.`);
    if (pull.commits < 1) return false;
    // The main it landed on is the first parent of its merge commit; a squash or rebase has no second.
    const parents = parentShas(this.get(`repos/${repository}/commits/${landed}`, budget)?.parents);
    if (parents?.length !== 2 || parents[1] !== head) return false;
    const main = parents[0];
    const listed = this.pages(`repos/${repository}/pulls/${train}/commits`, budget);
    if (listed.length !== pull.commits) throw new Error('Merge train commits incomplete.');
    const commits = new Map();
    for (const entry of listed) {
      const sha = lower(entry?.sha); const ups = parentShas(entry?.parents);
      if (!SHA40.test(sha) || !ups?.length || typeof entry.commit?.message !== 'string') throw new Error('Malformed merge train commit.');
      commits.set(sha, { sha, parents: ups, message: entry.commit.message });
    }
    const chain = [];
    for (let at = head; commits.has(at); at = commits.get(at).parents[0]) {
      if (chain.length >= commits.size) return false;
      chain.unshift(commits.get(at));
    }
    if (!chain.length || !this.holds(repository, main, chain[0].parents[0], budget)) return false;
    const rowByHead = new Map(rows.map(row => [row.head, row]));
    const boarded = new Set();
    const unreverted = new Map(); // merged head the table does not list -> its merge commit
    for (const [index, { sha, parents: ups, message }] of chain.entries()) {
      if (ups.length > 2) return false;
      if (ups.length === 2) {
        const row = rowByHead.get(ups[1]);
        if (row) {
          // A table row proves nothing alone: it must name another pull request that GitHub shows
          // merged at exactly that head (backing members were read so already).
          if (row.pr === train || boarded.has(row.pr) || !backing.includes(row) && !this.mergedAt(repository, row, budget)) return false;
          boarded.add(row.pr);
          continue;
        }
        if (this.holds(repository, main, ups[1], budget)) continue;
        if (unreverted.has(ups[1])) return false;
        unreverted.set(ups[1], sha);
        continue;
      }
      const ejected = ejectHead(message);
      if (ejected) {
        const boarding = unreverted.get(ejected);
        if (!boarding || !this.reverts(repository, sha, boarding, budget)) return false;
        unreverted.delete(ejected);
        continue;
      }
      // A bump comes after every merge: eject only adds reverts and a fresh bump on top of it.
      if (chain.slice(index + 1).some(commit => commit.parents.length !== 1) || !this.bumpOnly(repository, sha, budget)) return false;
    }
    return unreverted.size === 0 && backing.every(row => boarded.has(row.pr));
  }
  // Whether `main` holds `commit` (one compare read unless they are the same commit).
  holds(repository, main, commit, budget) {
    if (commit === main) return true;
    return ['ahead', 'identical'].includes(this.get(`repos/${repository}/compare/${commit}...${main}?per_page=1`, budget)?.status);
  }
  // Whether `revert` changes exactly the lines `boarding` changed, the other way round, in the same files.
  reverts(repository, revert, boarding, budget) {
    const [undo, done] = [revert, boarding].map(sha => this.get(`repos/${repository}/commits/${sha}`, budget)?.files);
    if (!Array.isArray(undo) || !Array.isArray(done) || !done.length || undo.length !== done.length || done.length >= MAX_COMMIT_FILES) return false;
    const byName = new Map(undo.map(file => [file?.filename, file]));
    const inverse = { added: 'removed', removed: 'added', modified: 'modified' };
    return byName.size === undo.length && done.every(file => {
      const back = byName.get(file?.filename);
      if (!back || !inverse[file.status] || back.status !== inverse[file.status] || typeof file.patch !== 'string' || typeof back.patch !== 'string') return false;
      const [a, b] = [patchChanges(file.patch), patchChanges(back.patch)];
      return sameLines(a.added, b.removed) && sameLines(a.removed, b.added);
    });
  }
  bumpOnly(repository, sha, budget) {
    if (typeof this.trainBump !== 'function') return false;
    const files = this.get(`repos/${repository}/commits/${sha}`, budget)?.files;
    return Array.isArray(files) && files.length > 0 && files.length < MAX_COMMIT_FILES && this.trainBump(files) === true;
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
          result = owed ? { status: 'refused', reason: `Issue ${target.repository}#${target.number} records UAT ${owed}: the owner's test is still owed. Keep it open and use Refs until the controller records UAT PASSED.` }
            : this.assertClosable(target.number, target.repository, budget, { resolved: issue });
          // Only a target the native tree allows is checked for merged owner-test PRs, so a proven
          // refusal is never turned into an unknown by a later read.
          if (result.status === 'allowed' && issue.state === 'open') {
            const waiting = this.ownerTestPrs(target.repository, target.number, budget);
            if (waiting.length) result = { status: 'refused', reason: `Issue ${target.repository}#${target.number} is referenced by merged PR ${waiting.map(pr => `#${pr}`).join(', ')}, whose UAT line is still OWNER_TEST_NEEDED: the owner's test is still owed. Keep it open and use Refs until the owner's OK makes that line UAT: PASSED.` };
          }
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
module.exports = { closingReferences, owedUat, mergeTrainRows, mergeTrainMembers, patchChanges, trainCarried, TRAIN_MERGE_WINDOW_MS, IssueClosureGuard };
