'use strict';
// Real-route qualification of conflict-protected programme publication against the
// agreed PRIVATE store. Bounded, task-owned effects only: one state file under the
// given prefix and one fixture issue, which is closed (not deleted) at the end.
// Usage: node repo/tests/qualification/programme-publication.live.cjs <owner/private-repo> <path-prefix> <episode-id>
const assert = require('node:assert/strict');
const { GhTransport, CanonicalStateStore, IssueProjectionPublisher, ProgrammeProjectionReconciler, sha256 } =
  require('../../scripts/toolkit-programme-publication.cjs');

const [repository, prefix, episode] = process.argv.slice(2);
if (!repository || !prefix || !/^[a-z0-9-]+$/.test(episode || '')) throw new Error('usage: <repo> <prefix> <episode>');
const gh = new GhTransport();
const json = args => { const r = GhTransport.spawn(args); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const meta = json(['api', `repos/${repository}`]);
assert.equal(meta.private, true, 'qualification target must be a private repository');

const log = [];
const step = (name, value) => { log.push({ step: name, at: new Date().toISOString(), ...value }); };

// 1. Canonical state with a real conditional write.
const store = new CanonicalStateStore({ transport: gh, repository, path: `${prefix}/${episode}/programme-state.json` });
assert.equal(store.read().exists, false, 'episode state path must be fresh');
const first = store.write({ episode, revision_note: 'initial', obligations: ['core', 'hardening'] }, null, `Qualification ${episode}: create canonical state`);
step('state-create', first); assert.equal(first.state, 'APPLIED');
const second = store.write({ episode, revision_note: 'advanced', obligations: ['core', 'hardening'] }, first.revision, `Qualification ${episode}: advance canonical state`);
step('state-advance', second); assert.equal(second.state, 'APPLIED');
const stale = store.write({ episode, revision_note: 'lost-update' }, first.revision, `Qualification ${episode}: stale write must be rejected`);
step('state-stale-negative', stale); assert.equal(stale.state, 'CONFLICT');
const current = store.read();
step('state-readback', { revision: current.revision, note: current.state.revision_note }); assert.equal(current.state.revision_note, 'advanced');

// 2. Issue projection on a task-owned fixture issue.
const created = json(['api', '-X', 'POST', `repos/${repository}/issues`, '-f', `title=Toolkit qualification fixture ${episode} (task-owned; safe to close)`,
  '-f', 'body=Task-owned fixture for conflict-protected projection qualification.\n']);
const issue = created.number; step('fixture-issue-created', { issue });
const publisher = new IssueProjectionPublisher({ transport: gh });
const reconciler = new ProgrammeProjectionReconciler({ publisher, render: (state, target) => `${target.role}: ${state.revision_note} @ ${current.revision}` });
const canonical = { revision: current.revision, state: current.state };
const targets = [{ issue, role: 'CHILD', marker: 'CURRENT' }];
const applied = reconciler.reconcile({ repository, canonical, targets });
step('projection-apply', applied.results[0]); assert.equal(applied.state, 'CURRENT'); assert.equal(applied.results[0].state, 'APPLIED');
const noop = reconciler.reconcile({ repository, canonical, targets });
step('projection-noop-retry', noop.results[0]); assert.equal(noop.results[0].state, 'NOOP');

// 3. Foreign edit after rendering: held, not overwritten.
const base = publisher.bodyDigest(repository, issue);
const live = gh.readIssue(repository, issue).body;
assert.equal(gh.writeIssueBody(repository, issue, `${live}\nForeign owner note A\n`).state, 'APPLIED');
const heldBefore = publisher.publish({ repository, issue, marker: 'CURRENT', block: `CHILD: next @ ${current.revision}`, base_digest: base });
step('foreign-edit-before-write', heldBefore); assert.equal(heldBefore.state, 'HOLD'); assert.equal(heldBefore.reason, 'FOREIGN_EDIT_BEFORE_WRITE');
assert.match(gh.readIssue(repository, issue).body, /Foreign owner note A/);

// 4. Edit racing between the check and the write: detected, preserved in history.
const racing = new (class extends GhTransport {
  #armed = true;
  writeIssueBody(r, n, body) {
    if (this.#armed) { this.#armed = false; const now = super.readIssue(r, n).body; super.writeIssueBody(r, n, `${now}\nRacing owner note B\n`); }
    return super.writeIssueBody(r, n, body);
  }
})();
const racePublisher = new IssueProjectionPublisher({ transport: racing });
const raceBase = racePublisher.bodyDigest(repository, issue);
const heldRace = racePublisher.publish({ repository, issue, marker: 'CURRENT', block: `CHILD: raced @ ${current.revision}`, base_digest: raceBase });
step('racing-edit-detected', heldRace); assert.equal(heldRace.state, 'HOLD'); assert.equal(heldRace.reason, 'INTERVENING_EDIT_PRESERVED_IN_HISTORY');
const history = json(['api', 'graphql', '-f', `query=query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){userContentEdits(first:10){nodes{diff}}}}}`,
  '-F', `o=${repository.split('/')[0]}`, '-F', `n=${repository.split('/')[1]}`, '-F', `i=${issue}`]);
const preserved = history.data.repository.issue.userContentEdits.nodes.some(n => /Racing owner note B/.test(n.diff || ''));
step('racing-edit-retrievable', { preserved }); assert.equal(preserved, true);

// 5. Eligible cleanup of the task-owned fixture: close it (history retained).
json(['api', '-X', 'PATCH', `repos/${repository}/issues/${issue}`, '-f', 'state=closed', '-f', 'state_reason=completed']);
const closed = json(['api', `repos/${repository}/issues/${issue}`]);
step('fixture-issue-closed', { state: closed.state }); assert.equal(closed.state, 'closed');

process.stdout.write(`${JSON.stringify({ schema: 'toolkit.qualification.programme-publication.v1', repository_private: true,
  episode, state_path: `${prefix}/${episode}/programme-state.json`, fixture_issue: issue, steps: log,
  result: 'PASS' }, null, 2)}\n`);
