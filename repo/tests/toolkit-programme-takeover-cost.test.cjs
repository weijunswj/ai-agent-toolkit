'use strict';

// Takeover reads the selected current document, regardless of historical runs and comments.
// The transport exposes the whole history; only real CLI/store code chooses what to request.
const assert = require('node:assert/strict');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

function fixture(history) {
  const github = new FakeGitHub();
  github.addIssue(12);
  const selected = github.addComment(12, { body: 'Release plan\n---\nApproved scope.', createdAt: '2026-10-01T00:00:00Z' });
  const binding = state.validateBinding({ schema: state.SCHEMA.bindingV2, repository: 'acme/app', governance: 'enabled',
    parents: [{ issue: 12, record_prefix: 'INT-APP-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' }, required_checks: ['validate'] });
  const current = state.newParent({ repository: binding.repository, parentIssue: 12, releasePlan: { record: 'SCOPE', comment_id: selected } });
  github.putFile('state/acme/app/parent-12.json', current);
  github.putFile('state/acme/app/issue-13.json', state.newChild({ repository: binding.repository, outcome: { issue: 13 } }));
  for (let i = 0; i < history; i += 1) {
    // These are ordinary reachable Contents files, not a pre-filtered store or a fake show().
    github.files.set(`state/acme/app/runs/run-${i}.json`, { text: JSON.stringify({ run: i, notes: 'Historical run '.repeat(100) }), sha: String(i).padStart(40, '0') });
    github.addComment(12, { body: `Old decision ${i}\n---\n${'Historical discussion '.repeat(100)}` });
  }
  const reads = [];
  const transport = {
    request(method, resource, body) {
      const response = github.request(method, resource, body);
      reads.push({ method, resource, bytes: Buffer.byteLength(JSON.stringify(response.json), 'utf8') });
      return response;
    },
  };
  function show(issue) {
    reads.length = 0;
    let output = '';
    assert.equal(cli.main(['show', '--json', ...(issue ? ['--issue', String(issue)] : ['--parent'])], {
      transport, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: '.', toolkitVersion: '3.9.0', environment: {},
      stdout: { write: text => { output += text; } },
    }), 0);
    return { result: JSON.parse(output), reads: [...reads] };
  }
  return { github, transport, reads, show, selected };
}

test('real show reads stay bounded with short or long history, and only selected evidence is fetched', () => {
  const short = fixture(2);
  const long = fixture(2000);
  for (const issue of [null, 13]) {
    const a = short.show(issue);
    const b = long.show(issue);
    assert.deepEqual(b.result, a.result, 'current state is identical');
    assert.deepEqual(b.reads, a.reads, 'requested resources and returned bytes do not grow');
    assert.equal(a.reads.length, 4, 'identity, store privacy, branch and one current document');
    assert.ok(a.reads.every(read => read.method === 'GET'));
    assert.equal(a.reads.filter(read => read.resource.includes('/contents/')).length, 1);
    assert.ok(a.reads.at(-1).resource.includes(`/contents/state/acme/app/${issue ? 'issue-13' : 'parent-12'}.json?ref=main`));
    assert.ok(a.reads.reduce((sum, read) => sum + read.bytes, 0) < 10000, 'a fixed response budget, not a timing assertion');
    assert.equal(a.reads.some(read => /comments|runs|commits|journal/.test(read.resource)), false);
  }
  const evidence = fx => {
    const { result } = fx.show();
    const id = result.document.release_plan.comment_id;
    const response = fx.transport.request('GET', `repos/acme/app/issues/comments/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.json.id, fx.selected);
    return [...fx.reads];
  };
  assert.deepEqual(evidence(long), evidence(short));
  assert.deepEqual(long.reads.filter(read => /comments/.test(read.resource)).map(read => read.resource), [`repos/acme/app/issues/comments/${long.selected}`]);
  // Positive control: history remains available at the same transport boundary and really grows.
  const bytes = (fx, resource) => Buffer.byteLength(JSON.stringify(fx.transport.request('GET', resource).json));
  for (const resource of ['repos/acme/state-store/contents/state/acme/app/runs?ref=main', 'repos/acme/app/issues/12/comments?per_page=100&page=1']) {
    assert.ok(bytes(long, resource) > bytes(short, resource), resource);
  }
});
