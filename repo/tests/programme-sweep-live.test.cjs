'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
let live = {}, sweep = {};
try {
  live = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep-live.cjs'));
  sweep = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs'));
} catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const { SweepGitHub } = require('./support/programme-sweep-github.cjs');

function fixture(count = 3, prCount = 6) {
  assert.equal(typeof live.LiveProgrammeSweep, 'function');
  const github = new SweepGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-', store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.repos.get(github.repository.toLowerCase()).default_branch = 'main';
  github.writeRaw(github.repository, 'main', '.github/toolkit-programme.json', JSON.stringify({ schema: state.SCHEMA.bindingV2,
    repository: github.repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-' }], store: binding.store, required_checks: [] }));
  const writer = { session: 'fixture-controller', prefix: 'TEST-' };
  github.addIssue(421, { body: '# Programme\n\n## CURRENT\n' });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  const now = () => new Date(github.clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.66.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), writer), { previous: null, sha: null });
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  for (let i = 0; i < prCount; i++) {
    const task = outcomes[i % count].issue;
    const number = 2000 + i;
    github.addPr(number, { head: 'a'.repeat(40), merged: true, body: `Refs #${task}` });
    const links = github.issuePrLinks.get(task) || { timeline: [] }; links.timeline.push(number); github.issuePrLinks.set(task, links);
  }
  const compiler = new state.Reconciler({ store, binding, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true, toolkitVersion: '3.66.0', now,
    reader: new state.ProgrammeGraphReader({ transport: github, repository: github.repository }), mutator: new state.GitHubMutator({ transport: github, repository: github.repository }) });
  // Seed the already-installed task layout. Cold below means no read cache or queue metadata.
  assert.deepEqual(compiler.run({ apply: true }).holds, []);
  const run = extra => {
    github.clock += 60 * 60 * 1000;
    const start = github.calls.length;
    const requests = new sweep.SweepRequests({ transport: github });
    const transport = requests;
    const nextStore = new state.StateStore({ transport, store: binding.store, now, toolkitVersion: '3.66.0' });
    const report = new live.LiveProgrammeSweep({ store: nextStore, transport, binding, writer: state.refreshWriter(nextStore.read('parent', 421).doc), version: '3.66.0', requests, now, ...extra }).run();
    return { report, requests: github.calls.length - start };
  };
  const runCLI = () => {
    github.clock += 60 * 60 * 1000;
    const start = github.calls.length;
    let output = '';
    const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
    const merged = new cli.MergedSweepBindingReader({ transport: github, repository: github.repository });
    merged.read({ repository_id: 'fixture-identity', remote: { canonical: `https://github.com/${github.repository}.git` } });
    assert.equal(merged.binding.governance, 'enabled');
    const code = cli.main(['refresh', '--json'], { transport: github, binding: merged.binding, originUrl: `https://github.com/${github.repository}.git`,
      repoRoot: ROOT, toolkitVersion: '3.66.0', now, lockFile: null, environment: {}, stdout: { write: value => { output += value; } } });
    return { code, report: JSON.parse(output), requests: github.calls.length - start };
  };
  return { github, store, binding, run, runCLI, now };
}

test('live complete pass renders saved facts and a truthful completion time', () => {
  const f = fixture();
  const first = f.run(); assert.equal(first.report.queue_left, 0);
  assert.deepEqual(first.report.holds, []);
  assert.match(f.github.issues.get(421).body, /Board out of date/);
  f.run();
  assert.match(f.github.issues.get(421).body, /Board updated:.*SGT \(state revision \d+\)/);
});

test('103 tasks and 645 PRs: cold catch-up within three passes, steady warm below eighty requests', t => {
  const f = fixture(103, 645);
  const baselineSize = f.github.issues.get(421).body.length;
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const result = f.runCLI(); cold.push(result.requests);
    assert.ok(result.requests <= 300);
  }
  const parent = f.store.read('parent', 421).doc;
  assert.deepEqual(parent.sweep.queue, []);
  const warm = f.runCLI();
  assert.ok(warm.requests < 80, `warm: ${warm.requests}`);
  assert.match(f.github.issues.get(421).body, /Board updated:/);
  assert.ok(f.github.issues.get(421).body.length < 60000);
  assert.ok(f.github.issues.get(421).body.length - baselineSize < 4096);
  t.diagnostic(JSON.stringify({ tasks: 103, prs: 645, cold_requests: cold, warm_requests: warm.requests }));
});

test('live document CAS re-queues the changed task and retains the controller revision', () => {
  const f = fixture();
  let snapshots = 0;
  f.github.intercept(call => {
    if (call.path === 'graphql' && call.body.query.includes('sweepStateSnapshot') && ++snapshots === 2) {
      const doc = f.store.read('child', 501).doc;
      doc.next_action = 'Keep the controller change'; doc.revision++;
      f.github.writeRaw(f.github.storeRepository, 'main', 'state/issue-501.json', state.canonicalText(doc));
    }
  });
  const result = f.run();
  assert.equal(result.report.queue_left, 1);
  assert.deepEqual(f.store.read('parent', 421).doc.sweep.queue, [501]);
  assert.equal(f.store.read('child', 501).doc.next_action, 'Keep the controller change');
});
