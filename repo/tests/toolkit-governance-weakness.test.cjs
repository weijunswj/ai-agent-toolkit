'use strict';

// A CI weakness governance finds is filed once as the controller's child task under the programme
// parent (owner decision of 28 November 2026, refining G-4f): filed, already open, and cannot-write.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WeaknessTasks, ghRequest, keyOf, taskFor } = require('../scripts/toolkit-governance-weakness.cjs');
const { filedWords } = require('../scripts/toolkit-governance-finish.cjs');

const REPO = 'toolkit-test-fixture/card';
const SKIPPABLE = Object.freeze({ kind: 'skippable', check: 'Quote Basis click budget', file: '.github/workflows/ci.yml', detail: '"Quote Basis click budget" (.github/workflows/ci.yml) waits for secret-scan without `if: always()`, so a failed one skips it and a skipped job reports success' });

// A GitHub with open issues and native sub-issues, answering the requests the filer makes.
function fakeGitHub({ issues = [], refuse = null } = {}) {
  const github = { issues: issues.map(issue => ({ ...issue })), links: [], calls: [] };
  github.request = (method, endpoint, input) => {
    github.calls.push([method, endpoint]);
    if (refuse && refuse(method, endpoint)) return { ok: false, reason: 'forbidden' };
    let match;
    if (method === 'GET' && (match = /^repos\/[^/]+\/[^/]+\/issues\?state=open&per_page=100&page=(\d+)$/.exec(endpoint))) {
      const page = Number(match[1]);
      return { ok: true, value: github.issues.filter(issue => issue.state === 'open').slice((page - 1) * 100, page * 100) };
    }
    if (method === 'POST' && /^repos\/[^/]+\/[^/]+\/issues$/.test(endpoint)) {
      const number = 100 + github.issues.length;
      github.issues.push({ number, id: 9000 + number, state: 'open', title: input.title, body: input.body });
      return { ok: true, value: { number, id: 9000 + number } };
    }
    if (method === 'POST' && (match = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/sub_issues$/.exec(endpoint))) {
      github.links.push([Number(match[1]), input.sub_issue_id]);
      return { ok: true, value: {} };
    }
    return { ok: false, reason: 'gh-request-failed' };
  };
  return github;
}

test('a CI weakness is filed once as a child task under the programme parent, with the file, the job, why it matters and the fix', () => {
  const github = fakeGitHub({ issues: [{ number: 7, state: 'open', body: 'an unrelated task' }, { number: 8, state: 'open', pull_request: {}, body: '' }] });
  const [result] = new WeaknessTasks({ request: github.request }).file(REPO, 1, [SKIPPABLE]);
  assert.deepEqual([result.state, result.number, result.parent], ['filed', 102, 1]);
  const filed = github.issues.find(issue => issue.number === 102);
  assert.equal(filed.title, 'CI: Required check "Quote Basis click budget" can be skipped and still count as passed (.github/workflows/ci.yml)');
  for (const part of ['**File:** `.github/workflows/ci.yml`', '**Job (required check):** `Quote Basis click budget`', '**Why it matters:**', '**The fix:** Run the job with `if: always()`', '## DONE WHEN\n\n- [ ] ', 'Nearest child:', `<!-- toolkit-weakness:${keyOf(SKIPPABLE)} -->`]) assert.ok(filed.body.includes(part), part);
  assert.deepEqual(github.links, [[1, 9102]], 'a native sub-issue of the parent');
  assert.equal(filedWords(result), ' Filed as #102 under #1.');
});

test('a weakness already filed and still open is named again and never filed twice; one said twice is one task', () => {
  const github = fakeGitHub();
  const tasks = new WeaknessTasks({ request: github.request });
  const reworded = { ...SKIPPABLE, detail: `${SKIPPABLE.detail} (said again)` };
  const first = tasks.file(REPO, 1, [SKIPPABLE, reworded]);
  assert.deepEqual(first.map(entry => [entry.state, entry.number]), [['filed', 100], ['filed', 100]], 'same check, kind and file: one task');
  const rerun = tasks.file(REPO, 1, [SKIPPABLE]);
  assert.deepEqual(rerun.map(entry => [entry.state, entry.number]), [['open', 100]]);
  assert.equal(filedWords(rerun[0]), ' Already filed as #100, still open.');
  assert.equal(github.issues.length, 1, 'filed once');
  // Closed: the weakness is back, so a new task is filed.
  github.issues[0].state = 'closed';
  assert.deepEqual(tasks.file(REPO, 1, [SKIPPABLE]).map(entry => entry.state), ['filed']);
});

test('where the task cannot be written, nothing is filed and the result says why, for the controller to file it', () => {
  const forbidden = fakeGitHub({ refuse: method => method === 'POST' });
  const [refused] = new WeaknessTasks({ request: forbidden.request }).file(REPO, 1, [SKIPPABLE]);
  assert.equal(refused.state, 'not-filed');
  assert.equal(filedWords(refused), ' Not filed as a task (GitHub refused this computer\'s sign-in); your controller files it.');
  // The open list cannot be read: nothing is written, since a task already filed could not be ruled out.
  const unread = fakeGitHub({ refuse: method => method === 'GET' });
  assert.deepEqual(new WeaknessTasks({ request: unread.request }).file(REPO, 1, [SKIPPABLE]).map(entry => entry.state), ['not-filed']);
  assert.deepEqual(unread.calls.filter(([method]) => method === 'POST'), []);
  // No parent issue: nothing is read or written.
  const none = fakeGitHub();
  const [orphan] = new WeaknessTasks({ request: none.request }).file(REPO, null, [SKIPPABLE]);
  assert.equal(filedWords(orphan), ' Not filed as a task (the programme file names no parent issue); your controller files it.');
  assert.deepEqual(none.calls, []);
  // Filed but not linked under the parent: named, with why, for the controller to link.
  const unlinked = fakeGitHub({ refuse: (method, endpoint) => endpoint.endsWith('/sub_issues') });
  const [loose] = new WeaknessTasks({ request: unlinked.request }).file(REPO, 1, [SKIPPABLE]);
  assert.equal(filedWords(loose), ' Filed as #100, but it could not be linked under #1 (GitHub refused this computer\'s sign-in); your controller links it.');
});

test('text from the repository\'s workflow files cannot mention anyone or break the task\'s lines', () => {
  const task = taskFor({ kind: 'no-producer', check: 'ping @owner\nnow', file: null, detail: 'no workflow job is named "ping @owner\nnow"' });
  assert.doesNotMatch(`${task.title}\n${task.body}`, /@owner/);
  assert.match(task.title, /^CI: Required check "ping \(at\)owner now" has no job that produces it$/);
});

test('the GitHub route maps a refused write to forbidden and a turned-off issues page to issues-off', () => {
  const answer = (status, stderr, stdout = '') => () => ({ status, stderr, stdout });
  assert.deepEqual(ghRequest('POST', 'repos/a/b/issues', { title: 't' }, { spawn: answer(1, 'gh: Resource not accessible by integration (HTTP 403)') }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(ghRequest('POST', 'repos/a/b/issues', { title: 't' }, { spawn: answer(1, 'gh: Issues are disabled for this repo (HTTP 410)') }), { ok: false, reason: 'issues-off' });
  assert.deepEqual(ghRequest('GET', 'repos/a/b/issues', null, { spawn: answer(1, 'gh: API rate limit exceeded (HTTP 403)') }), { ok: false, reason: 'gh-request-failed' });
  assert.deepEqual(ghRequest('GET', 'repos/a/b/issues', null, { spawn: answer(0, '', '[{"number":1}]') }), { ok: true, value: [{ number: 1 }] });
});

// G2 round 1, L4: a task filed before whose link under the parent failed is linked on the next run;
// one the controller moved under another parent stays there.
test('an open task with no parent is linked under the parent on the next run; one under another parent is left alone', () => {
  const github = fakeGitHub({ issues: [{ number: 50, id: 9050, state: 'open', body: `<!-- toolkit-weakness:${keyOf(SKIPPABLE)} -->` }] });
  const parents = new Map([[50, null]]);
  const request = (method, endpoint, input) => {
    const match = /\/issues\/(\d+)\/parent$/.exec(endpoint);
    if (method === 'GET' && match) return parents.get(Number(match[1])) ? { ok: true, value: { number: parents.get(Number(match[1])) } } : { ok: false, reason: 'not-visible' };
    return github.request(method, endpoint, input);
  };
  const [relinked] = new WeaknessTasks({ request }).file(REPO, 1, [SKIPPABLE]);
  assert.deepEqual([relinked.state, relinked.number], ['relinked', 50]);
  assert.deepEqual(github.links, [[1, 9050]]);
  assert.equal(filedWords(relinked), ' Already filed as #50, still open, and now linked under #1.');
  parents.set(50, 7);
  const [moved] = new WeaknessTasks({ request }).file(REPO, 1, [SKIPPABLE]);
  assert.equal(moved.state, 'open');
  assert.equal(github.links.length, 1, 'never moved from the parent the controller chose');
});

// G2 round 1, L3: a finding Toolkit could not confirm is filed as one to check, never stated as fact;
// one weakness said twice (two missing ecosystems in one Dependabot file) is one task naming both.
test('an unconfirmed finding is filed as one to check, and one file\'s two gaps are one task naming both', () => {
  const unread = taskFor({ kind: 'no-producer', check: 'Quote Basis click budget', file: null, detail: 'no readable workflow job is named "Quote Basis click budget"', unverified: true });
  assert.match(unread.title, /cannot be confirmed to report and fail as it should$/);
  assert.doesNotMatch(unread.title, /has no job that produces it/);
  assert.match(unread.body, /\*\*The fix:\*\* Check the finding; if it holds: Add a job/);
  const github = fakeGitHub();
  const gap = ecosystem => ({ kind: 'dependabot-ecosystem', check: null, file: '.github/dependabot.yml', detail: `.github/dependabot.yml has no "${ecosystem}" entry for /`, unverified: false });
  const results = new WeaknessTasks({ request: github.request }).file(REPO, 1, [gap('npm'), gap('pip')]);
  assert.deepEqual(results.map(entry => [entry.state, entry.number]), [['filed', 100], ['filed', 100]]);
  assert.equal(github.issues.length, 1);
  assert.equal(github.issues[0].title, 'CI: Dependabot file .github/dependabot.yml misses a package ecosystem');
  assert.ok(github.issues[0].body.includes('**Found:** .github/dependabot.yml has no "npm" entry for /; .github/dependabot.yml has no "pip" entry for /.'), github.issues[0].body);
});
