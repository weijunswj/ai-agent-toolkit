'use strict';

const { FakeGitHub } = require('../toolkit-programme-fake-github.cjs');

// Synthetic programme at the measured parent's scale. No owner text or private state is copied.
// Eight active tasks, ten queued, forty completed and fourteen retired; four PRs per task.
function renderScaleFixture(state, { count = 72, proseSize = 38100 } = {}) {
  const repository = 'example.test/app';
  const github = new FakeGitHub({ repository, store: 'example.test/store' });
  const writer = { session: 'fixture-controller', prefix: 'TEST-' };
  const now = '2026-11-08T00:00:00Z';
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, label: `Task ${i + 1}`, parent: 421, order: i + 1,
    class: i < 18 ? 'COMMITTED' : i < 58 ? 'COMPLETED' : 'RETIRED',
    name: `Programme task ${i + 1}: shared service behaviour`,
    description: 'Keep the shared service behaviour accurate across supported hosts, with clear owner actions, checked state and recoverable failures.' }));
  const parent = state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), writer, {});
  parent.attention = state.foldAttention([], { source: 'reconcile', complete: true, now: '2026-11-06T00:00:00Z',
    seen: Array.from({ length: 106 }, (_, i) => ({ code: 'CHILD_REOPENED', issue: 1000 + i })) });
  const prose = '# Programme\n\n## Owner notes\n\n' + 'Owner-maintained direction. '.repeat(Math.ceil(proseSize / 27));
  const handWritten = prose.slice(0, proseSize - 1) + '\n';
  github.addIssue(421, { body: handWritten });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => now });
  store.write('parent', 421, parent, { sha: null, previous: null });
  const children = new Map();
  const issues = new Map();
  for (const [i, outcome] of outcomes.entries()) {
    const child = state.newChild({ repository, outcome });
    child.lifecycle = i < 8 ? 'ACTIVE' : i < 18 ? 'PLANNED' : i < 58 ? 'DONE' : 'RETIRED';
    const terminal = i >= 18;
    const issue = github.addIssue(outcome.issue, { parent: 421, title: outcome.name, state: terminal ? 'closed' : 'open' });
    if (terminal) {
      issue.state_reason = i < 58 ? 'completed' : 'not_planned';
      issue.closed_at = child.completed_at = '2026-11-01T00:00:00Z';
    }
    child.prs = Array.from({ length: 4 }, (_, j) => {
      const number = 2000 + i * 4 + j;
      const merged = j > 0;
      github.addPr(number, { head: 'a'.repeat(40), state: merged ? 'OPEN' : 'CLOSED', merged,
        mergedAt: merged ? `2026-11-0${4 - j}T00:00:00Z` : null, body: `Refs #${outcome.issue}` });
      return { number, state: merged ? 'MERGED' : 'CLOSED', merge_sha: merged ? 'b'.repeat(40) : null };
    });
    // Deliberately keep the current PR last in history: the summary must use pr, not prs[0].
    child.prs.push(child.prs.shift());
    github.issuePrLinks.set(outcome.issue, { timeline: child.prs.map(pr => pr.number) });
    child.pr.number = 2000 + i * 4;
    child.pr.state = 'CLOSED';
    children.set(outcome.issue, child);
    issues.set(outcome.issue, github.issueJson(issue));
    store.write('child', outcome.issue, child, { sha: null, previous: null });
  }
  const reconciler = new state.Reconciler({ binding, store, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true,
    reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    toolkitVersion: '3.56.0', now: () => now });
  return { parent, children, issues, github, store, reconciler, handWritten, now };
}

module.exports = { renderScaleFixture };
