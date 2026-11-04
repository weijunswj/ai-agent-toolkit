'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GovernanceProposals, GitHubProposalTransport, validProposal } = require('../scripts/toolkit-governance-proposal.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const { recordAbsent, recordMerged } = require('./toolkit-governed-fixture-support.cjs');
const { seedMerged } = require('./support/governance-observations.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
function fixture(t, transport = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-proposal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repo'), home = path.join(root, 'home');
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.git', 'config'), '[remote "origin"]\n url = https://github.com/example-owner/example-repo.git\n');
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const registryOptions = { registryPath, testOnly: true };
  recordAbsent(cwd, { registryPath });
  const options = { registryOptions, transport };
  return { root, cwd, home, registryPath, registryOptions, owner: new GovernanceProposals(options), options };
}
const proposal = (answer = 'no', number = 1) => ({ repository: 'example-owner/example-repo', number, head: 'a'.repeat(40), url: `https://github.com/example-owner/example-repo/pull/${number}`, state: 'open', answer });
const run = { sessionId: 'owner', epoch: 'e'.repeat(32) };
for (const answer of ['yes', 'no']) test(`${answer}: accepted answer remains pending, isolated from other chats and effective state`, t => {
  const f = fixture(t);
  f.owner.request(f.cwd, answer, run);
  assert.equal(f.owner.pending(f.cwd, run).answer, answer);
  assert.equal(f.owner.pending(f.cwd, { ...run, sessionId: 'other' }), null);
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'UNDECIDED');
  assert.equal(fs.existsSync(f.registryPath), false);
  assert.equal(f.owner.request(f.cwd, answer, run).run, f.owner.pending(f.cwd, run).run);
  assert.throws(() => f.owner.request(f.cwd, answer === 'yes' ? 'no' : 'yes', run), /CONFLICT/);
});
test('no prepares the minimal off file; yes refuses missing or foreign adoption', t => {
  const f = fixture(t), request = f.owner.request(f.cwd, 'no', run);
  assert.deepEqual(f.owner.prepare(f.cwd, request.run).binding, { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' });
  const yes = f.owner.request(f.cwd, 'yes', { ...run, sessionId: 'yes' });
  for (const binding of [null, {}, { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/foreign', governance: 'disabled' }]) assert.throws(() => f.owner.prepare(f.cwd, yes.run, binding), /ADOPTION_INCOMPLETE/);
  assert.throws(() => f.owner.prepare(f.cwd, '0'.repeat(32)), /RECEIPT_REQUIRED/);
});
test('publication discovers, writes once and reads back; another chat sees the pending PR', t => {
  let open = [], writes = 0;
  const f = fixture(t, { list: () => open, publish() { writes++; open = [proposal()]; return open[0]; }, read: () => open[0] });
  const request = f.owner.request(f.cwd, 'no', run);
  assert.match(f.owner.publish(f.cwd, request.run).text, /merge this pull request now/);
  f.owner.publish(f.cwd, request.run);
  assert.equal(writes, 1);
  assert.equal(f.owner.pending(f.cwd, { ...run, sessionId: 'new-chat' }).kind, 'published');
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'UNDECIDED');
  open = []; f.owner.refresh(f.cwd);
  assert.equal(f.owner.pending(f.cwd, run), null, 'closed unmerged proposal ends the run request too');
});
test('conflicting proposals require the owner choice, never newest wins', t => {
  const f = fixture(t, { list: () => [proposal('yes'), proposal('no', 2)] });
  const request = f.owner.request(f.cwd, 'no', run);
  f.owner.refresh(f.cwd);
  assert.equal(f.owner.pending(f.cwd).kind, 'conflict');
  assert.throws(() => f.owner.publish(f.cwd, request.run), /CONFLICT/);
});
test('unavailable discovery continues ordinary work and grants no decision or merge authority', t => {
  const f = fixture(t, { list() { throw Error('offline'); } });
  assert.equal(f.owner.refresh(f.cwd).ok, false);
  assert.equal(new gate.GovernanceGate(f.options).evaluate(f.cwd).hold, false);
  assert.match(f.owner.pending(f.cwd).text, /couldn't check/);
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).programme_records_bind, false);
});
test('merged repository decision beats an opposite pending proposal and historical damage', t => {
  const f = fixture(t), request = f.owner.request(f.cwd, 'no', run);
  assert.ok(request.run);
  fs.writeFileSync(f.registryPath, '{damaged');
  seedMerged(f.cwd, 'enable', f.options);
  const state = governance.governanceState(f.cwd, f.registryOptions);
  assert.equal(state.state, 'ENABLED');
  assert.equal(new gate.GovernanceGate(f.options).evaluate(f.cwd).hold, false);
  assert.equal(fs.readFileSync(f.registryPath, 'utf8'), '{damaged');
});
test('later is same run only; concurrent chat does not invalidate accepted provenance', t => {
  const f = fixture(t), options = { registryOptions: f.registryOptions, environment: {} };
  gate.startSession({ cwd: f.cwd, session_id: 'owner', source: 'startup' }, options);
  const hold = new gate.PromptHold(options);
  assert.equal(hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'Do this work' }).action, 'block');
  gate.startSession({ cwd: f.cwd, session_id: 'other', source: 'startup' }, options);
  assert.equal(hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'later' }).action, 'pass');
  assert.equal(new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'owner' }).hold, false);
  assert.equal(new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'other' }).hold, true);
});
test('hostile proposal metadata and answer shapes never pass validation', t => {
  const f = fixture(t);
  const hostile = require('./support/hostile-inputs.cjs');
  for (const value of [null, {}, 'yes', ...Object.values(hostile).filter(Array.isArray).flat().filter(item => item?.text).map(item => item.text)]) {
    assert.ok(!validProposal(value, 'example-owner/example-repo'));
  }
  for (const changed of [{ state: 'closed' }, { answer: 'yes\nno' }, { head: 'bad' }, { url: 'https://example.test/pull/1' }, { repository: 'other/repo' }]) assert.equal(validProposal({ ...proposal(), ...changed }, 'example-owner/example-repo'), false);
  assert.equal(validProposal(proposal(), 'Example-Owner/Example-Repo'), true, 'GitHub clone spelling never changes proposal identity');
  for (const answer of ['YES', 'no\nyes', '"yes"', { confirmed: true }, null]) assert.throws(() => f.owner.request(f.cwd, answer, run), /RUN_INVALID/);
});

test('a busy receipt store refuses the answer without losing another chat request', t => {
  const f = fixture(t);
  f.owner.request(f.cwd, 'no', run);
  const directory = path.join(f.home, '.ai-agent-toolkit', 'user-state', 'governance-proposals');
  const file = path.join(directory, fs.readdirSync(directory)[0]), before = fs.readFileSync(file);
  fs.writeFileSync(`${file}.lock`, '');
  assert.throws(() => f.owner.request(f.cwd, 'yes', { ...run, sessionId: 'other' }), /BUSY/);
  assert.deepEqual(fs.readFileSync(file), before);
  fs.rmSync(`${file}.lock`);
  f.owner.request(f.cwd, 'yes', { ...run, sessionId: 'other' });
  assert.equal(f.owner.pending(f.cwd, run).answer, 'no');
  assert.equal(f.owner.pending(f.cwd, { ...run, sessionId: 'other' }).answer, 'yes');
});

test('a failed publication readback never reports success or activates the proposal', t => {
  const f = fixture(t, { list: () => [], publish: () => proposal(), read: () => ({ ...proposal(), head: 'b'.repeat(40) }) });
  const request = f.owner.request(f.cwd, 'no', run);
  assert.throws(() => f.owner.publish(f.cwd, request.run), /READBACK_FAILED/);
  assert.equal(f.owner.pending(f.cwd, run).kind, 'preparing');
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).programme_records_bind, false);
  assert.equal(fs.existsSync(f.registryPath), false);
});

test('merge readback discards only the completed run receipt', t => {
  const f = fixture(t);
  f.owner.request(f.cwd, 'no', run);
  f.owner.request(f.cwd, 'yes', { ...run, sessionId: 'other' });
  seedMerged(f.cwd, 'disable', f.options);
  f.owner.settle(f.cwd, governance.governanceState(f.cwd, f.registryOptions));
  assert.equal(f.owner.pending(f.cwd, run), null);
  assert.equal(f.owner.pending(f.cwd, { ...run, sessionId: 'other' }).answer, 'yes');
});

test('CLI transport authenticates before writing and writes only the proposal branch', () => {
  const calls = [], repository = 'example-owner/example-repo';
  const off = { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' };
  const transport = new GitHubProposalTransport({ run(args, input) {
    calls.push({ args, input });
    const endpoint = args[1];
    if (args[0] === 'auth') return '';
    if (endpoint === 'user') return JSON.stringify({ login: 'example-owner' });
    if (endpoint === `repos/${repository}`) return JSON.stringify({ default_branch: 'main' });
    if (endpoint.includes('/git/ref/heads/toolkit/')) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
    if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
    if (endpoint.includes('/git/commits/')) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
    if (endpoint.includes('/git/trees/')) return JSON.stringify({ truncated: false, tree: [] });
    if (endpoint.endsWith('/git/refs')) return '{}';
    if (endpoint.includes('/contents/')) return JSON.stringify({ commit: { sha: 'c'.repeat(40) } });
    if (endpoint.endsWith('/pulls')) return JSON.stringify({ number: 1 });
    throw Error('unexpected endpoint');
  } });
  assert.deepEqual(transport.publish(repository, off), { number: 1, head: 'c'.repeat(40) });
  const firstWrite = calls.findIndex(item => item.input);
  assert.equal(calls[0].args.join(' '), 'auth status');
  assert.equal(calls[1].args.join(' '), 'api user');
  assert.ok(firstWrite > 1);
  const ref = calls.find(item => item.input?.ref)?.input.ref;
  assert.match(ref, /^refs\/heads\/toolkit\/governance-off-/);
  const fileWrite = calls.find(item => item.input?.content)?.input;
  assert.ok(calls.find(item => item.input?.content).args.includes('PUT'), 'Contents API writes require PUT');
  assert.equal(`refs/heads/${fileWrite.branch}`, ref);
  assert.deepEqual(JSON.parse(Buffer.from(fileWrite.content, 'base64')), off);
  assert.ok(!calls.some(item => item.args.join(' ').includes('/merge')));
});

test('PR discovery refuses incomplete pagination, a foreign head and an invalid binding', () => {
  const repository = 'example-owner/example-repo';
  const transport = response => new GitHubProposalTransport({ run: () => JSON.stringify(response) });
  assert.throws(() => transport(new Array(100).fill({})).list(repository), /LIST_INCOMPLETE/);
  assert.throws(() => transport({ state: 'open', body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: 'someone/else' }, sha: 'a'.repeat(40) } }).read(repository, 1), /PR_INVALID/);
  const responses = [
    { state: 'open', changed_files: 1, body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: repository }, sha: 'a'.repeat(40) }, base: { ref: 'main' } },
    { default_branch: 'main' },
    { tree: { sha: 'b'.repeat(40) } },
    { truncated: false, tree: [{ path: '.github/toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
    { type: 'file', sha: 'c'.repeat(40), encoding: 'base64', size: 2, content: Buffer.from('{}').toString('base64') },
  ];
  const badBinding = new GitHubProposalTransport({ run: () => JSON.stringify(responses.shift()) });
  assert.throws(() => badBinding.read(repository, 1));
});

test('a marked off PR with unrelated changes cannot be reused as a minimal decision', () => {
  const repository = 'example-owner/example-repo';
  const responses = [
    { state: 'open', changed_files: 2, body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: repository }, sha: 'a'.repeat(40) }, base: { ref: 'main' } },
    { default_branch: 'main' },
    { tree: { sha: 'b'.repeat(40) } },
    { truncated: false, tree: [{ path: '.github/toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
    { type: 'file', sha: 'c'.repeat(40), encoding: 'base64', size: 100, content: Buffer.from(JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' })).toString('base64') },
    [{ filename: '.github/toolkit-programme.json', status: 'modified' }, { filename: 'src/index.js', status: 'modified' }],
  ];
  const transport = new GitHubProposalTransport({ run: () => JSON.stringify(responses.shift()) });
  assert.throws(() => transport.read(repository, 1), /SCOPE_INVALID/);
});

for (const answer of ['no', 'yes']) test(`transport reads a complete ${answer} proposal at its exact head, allowing adoption rules for yes`, () => {
  const repository = 'example-owner/example-repo', expected = proposal(answer);
  const text = JSON.stringify(answer === 'no' ? { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' } : {
    schema: 'toolkit.programme-binding.v1', repository, parent_issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX',
    store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'],
  });
  const responses = [
    { number: expected.number, html_url: expected.url, state: 'open', changed_files: answer === 'no' ? 1 : 2, body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: repository }, sha: expected.head }, base: { ref: 'main' } },
    { default_branch: 'main' },
    { tree: { sha: 'b'.repeat(40) } },
    { truncated: false, tree: [{ path: '.github/toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
    { type: 'file', sha: 'c'.repeat(40), encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') },
    [{ filename: '.github/toolkit-programme.json', status: 'added' }],
  ];
  const calls = [];
  const transport = new GitHubProposalTransport({ run: args => { calls.push(args[1]); return JSON.stringify(responses.shift()); } });
  assert.deepEqual(transport.read(repository, expected.number), expected);
  assert.ok(calls.some(endpoint => endpoint.endsWith(`?ref=${expected.head}`)));
});

test('interrupted publication reuses only its exact unchanged proposal branch', () => {
  const repository = 'example-owner/example-repo';
  const binding = { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' };
  const text = `${JSON.stringify(binding, null, 2)}\n`;
  for (const stage of ['branch-only', 'committed', 'changed']) {
    const calls = [];
    const transport = new GitHubProposalTransport({ run(args, input) {
      calls.push({ args, input }); const endpoint = args[1];
      if (args[0] === 'auth') return '';
      if (endpoint === 'user') return JSON.stringify({ login: 'example-owner' });
      if (endpoint === `repos/${repository}`) return JSON.stringify({ default_branch: 'main' });
      if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
      if (endpoint.includes('/git/ref/heads/toolkit/')) return JSON.stringify({ object: { sha: (stage === 'branch-only' ? 'a' : 'c').repeat(40) } });
      if (endpoint.includes('/git/commits/')) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
      if (endpoint.includes('/git/trees/')) return JSON.stringify({ truncated: false, tree: [] });
      if (endpoint.includes('/compare/')) return JSON.stringify({ total_commits: 1, merge_base_commit: { sha: 'a'.repeat(40) }, files: [{ filename: stage === 'changed' ? 'other.txt' : '.github/toolkit-programme.json' }] });
      if (endpoint.includes('/contents/') && !input) return JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') });
      if (endpoint.includes('/contents/') && input) return JSON.stringify({ commit: { sha: 'c'.repeat(40) } });
      if (endpoint.endsWith('/pulls')) return JSON.stringify({ number: 1 });
      throw Error('unexpected endpoint');
    } });
    if (stage === 'changed') assert.throws(() => transport.publish(repository, binding), /BRANCH_CHANGED/);
    else assert.deepEqual(transport.publish(repository, binding), { number: 1, head: 'c'.repeat(40) });
    assert.equal(calls.filter(item => item.input?.ref).length, 0, 'existing branch is never recreated or reset');
    assert.equal(calls.filter(item => item.input?.content).length, stage === 'branch-only' ? 1 : 0);
    if (stage === 'changed') assert.equal(calls.filter(item => item.input).length, 0, 'foreign changes receive no writes');
  }
});
