'use strict';
const { FakeGitHub } = require('../toolkit-programme-fake-github.cjs');
const NOW = '2026-11-09T00:00:00.000Z';
const writer = { session: 'fixture-controller', prefix: 'TEST-' };

function pageFixture(state, { count = 0, hand = '# Programme\n\nUnmarked notes.\n', groups = ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'], width = 100 } = {}) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 12, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(12, { body: hand });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 100 + i, class: groups[i % groups.length] === 'NOW' || groups[i % groups.length] === 'LATER' ? 'COMMITTED' : groups[i % groups.length],
    name: `Task ${i}`, description: 'x'.repeat(width), parent: 12, order: count - i }));
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW, toolkitVersion: '3.57.0' });
  store.write('parent', 12, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 12, outcomes }), writer, {}), { previous: null, sha: null });
  const children = new Map(), issues = new Map();
  for (const [i, outcome] of outcomes.entries()) {
    const group = groups[i % groups.length];
    const issue = github.addIssue(outcome.issue, { parent: 12, state: ['COMPLETED', 'RETIRED'].includes(group) ? 'closed' : 'open' });
    if (issue.state === 'closed') issue.state_reason = group === 'COMPLETED' ? 'completed' : 'not_planned';
    const child = state.newChild({ repository: github.repository, outcome });
    if (group === 'NOW') { child.lifecycle = 'ACTIVE'; child.gate = { role: 'G1', state: 'ACTIVE', session_id: null, route: null, returns: [] }; }
    if (issue.closed_at) child.completed_at = issue.closed_at;
    store.write('child', outcome.issue, child, { previous: null, sha: null });
    children.set(outcome.issue, store.read('child', outcome.issue).doc); issues.set(outcome.issue, issue);
  }
  const make = () => new state.Reconciler({ binding, store, writer, toolkitVersion: '3.57.0', now: () => NOW,
    reader: new state.ProgrammeGraphReader({ transport: github, repository: github.repository }),
    mutator: new state.GitHubMutator({ transport: github, repository: github.repository }) });
  const parent = () => store.read('parent', 12).doc;
  const project = (source = github.issues.get(12).body, budget = 5) => make().projectBody(12, source, state.renderParentBlockBody(parent(), children, issues), github.commentsOf(12), '3.57.0', null,
    state.renderCurrentBlockBody(parent(), children, issues, NOW), null, budget, { parent: parent(), only: false });
  const posts = () => github.calls.filter(call => call.method === 'POST' && /issues\/12\/comments$/.test(call.path));
  const edits = () => github.calls.filter(call => call.method === 'PATCH' && /issues\/comments\//.test(call.path));
  const page = () => github.issues.get(12).body;
  return { github, binding, store, make, parent, project, children, issues, posts, edits, page, writer, NOW };
}
module.exports = { pageFixture };
