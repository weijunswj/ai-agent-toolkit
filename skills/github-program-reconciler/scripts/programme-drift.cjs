'use strict';

// Drift findings (pure). When part of a programme falls behind its state, the reconciler says so,
// so no gap waits for someone to notice it by hand. The reconciler gathers the facts of one pass and
// these functions decide. Each finding resolves by itself on the first full pass that no longer sees
// it. A finding names a task, a task page or a PR page; the pass's own report carries the detail.
//
// What the reconciler already reports is not repeated here: a native child that is not on the graph
// is added to it (CHILD_ADDED), an open issue under no registered parent is NEEDS_PLACEMENT, a page
// too large for its write is BODY_TOO_LARGE, and a page the layout holds is PAGE_LAYOUT_HELD.

// The codes and their next steps are rows of the reconciler's finding table (FINDING_CODES).
const DRIFT_CODES = Object.freeze(['CHILD_NOT_NATIVE', 'BLOCKS_MISSING', 'BLOCK_BEHIND', 'PR_NAV_MISSING', 'NEXT_ACTION_STALE']);

// Issues an open task PR names that are not on the graph are read one at a time, at most this many
// per pass; the rest wait for a later pass.
const REFERENCE_READS = 5;

// Findings the same pass raised that already say why a page was not redrawn.
const EXPLAINING_CODES = new Set(['MANAGED_BLOCK_BROKEN', 'PAGE_LAYOUT_HELD', 'BODY_TOO_LARGE', 'BODY_OVER_BUDGET']);

// The state revision a task page was drawn from (the STATUS block's `State revision <n>` line), or
// null when the page shows none. A page drawn at the stored revision shows the stored state, whatever
// Toolkit version drew it: an older look is redrawn by the sweep's rotation, and is not drift.
function drawnRevision(body) {
  const match = /State revision (\d+) \(issue-\d+\.json\)/.exec(String(body || ''));
  return match ? Number(match[1]) : null;
}

// pages: [{ number, block: 'missing' | 'behind' | 'current', planned, explained, holding: [effect kinds] }]
function pageDrift(pages) {
  const findings = [];
  for (const page of pages) {
    if (page.planned || page.explained || page.block === 'current') continue;
    const held = page.holding?.length ? `; held by ${page.holding.join(', ')} left in flight` : '';
    if (page.block === 'missing') findings.push({ code: 'BLOCKS_MISSING', issue: page.number, detail: `the open task page has no generated blocks and none were planned${held}` });
    else findings.push({ code: 'BLOCK_BEHIND', issue: page.number, detail: `the page shows an older state than the stored document and no redraw was planned${held || '; no effect is in flight'}` });
  }
  return findings;
}

// prs: [{ number, nav: 'present' | 'missing' | 'broken', planned }]
function prNavDrift(prs) {
  return prs.filter(pr => pr.nav !== 'present' && !pr.planned)
    .map(pr => ({ code: 'PR_NAV_MISSING', issue: pr.number, detail: pr.nav === 'broken' ? 'the PATH block markers on the PR page are broken, so it is not redrawn' : 'the open task PR has no PATH block and none was planned' }));
}

// The issues open task PRs name that are not on this graph: { number, prs } in issue order.
function referenceCandidates({ references, taskPrs, parentIssue, catalogued, registered, knownPrs }) {
  const list = [];
  for (const [number, prs] of references) {
    const tasks = prs.filter(pr => taskPrs.has(pr));
    if (!tasks.length || number === parentIssue || catalogued.has(number) || registered.has(number) || knownPrs.has(number)) continue;
    list.push({ number, prs: tasks });
  }
  return list.sort((a, b) => a.number - b.number);
}

// candidates: [{ number, prs, facts }] with facts as the reader returns them, or null when unread.
// An open issue under no registered parent is the inventory's NEEDS_PLACEMENT, so only a closed one
// is reported here; an issue under another registered parent belongs to that programme.
function referenceDrift(candidates, { parentIssue, catalogued, registered }) {
  const findings = [];
  for (const { number, prs, facts } of candidates) {
    if (!facts || facts.is_pull_request || facts.state !== 'closed') continue;
    if (facts.parent === parentIssue || catalogued.has(facts.parent) || registered.has(facts.parent)) continue;
    findings.push({ code: 'CHILD_NOT_NATIVE', issue: number, detail: `open task PR ${prs.map(pr => `#${pr}`).join(', ')} names this closed issue, which is not under the programme parent` });
  }
  return findings;
}

// tasks: [{ number, nextAction, since, latest: { at, what } | null }]; `since` is when the next action
// was last set (null for a document written before the time was kept: never reported).
function nextActionDrift(tasks) {
  const findings = [];
  for (const task of tasks) {
    const since = Date.parse(task.since || '');
    const latest = Date.parse(task.latest?.at || '');
    if (!Number.isFinite(since) || !Number.isFinite(latest) || latest <= since) continue;
    findings.push({ code: 'NEXT_ACTION_STALE', issue: task.number, detail: `the next action was set at ${new Date(since).toISOString().slice(0, 16)}Z, before ${task.latest.what} at ${new Date(latest).toISOString().slice(0, 16)}Z` });
  }
  return findings;
}

// Keeps when the next action was last set, in the document's private part, on every write that
// creates the document or changes its next action. An older document keeps no time until its next
// action changes, so it is never reported as stale on a guess.
function stampNextAction(previous, next, now) {
  if (next?.next_action === undefined) return next;
  if (previous && previous.next_action === next.next_action) return next;
  next.private = { ...(next.private || {}), next_action_at: now };
  return next;
}

module.exports = Object.freeze({ drawnRevision, DRIFT_CODES, REFERENCE_READS, EXPLAINING_CODES, pageDrift, prNavDrift, referenceCandidates, referenceDrift, nextActionDrift, stampNextAction });
