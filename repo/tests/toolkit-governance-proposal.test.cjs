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
const { managedAgentsCopy } = require('./support/retired-instruction-copies.cjs');
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
function fakeGitHub(f, extra = {}) {
  const file = path.join(f.root, 'github.json');
  fs.writeFileSync(file, JSON.stringify({ repository: 'example-owner/example-repo', calls: [], files: {}, ...extra }));
  return { transport: new GitHubProposalTransport({ command: [process.execPath, path.join(__dirname, 'support/governance-fake-github.cjs'), file] }), read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
// full: also the CI files every turn-on carries beside the programme file (the plain-text check).
// rules: the instruction copies older turn-ons wrote (a governed AGENTS.md block, CLAUDE.md and a
// playbook), which the installed Toolkit now delivers, so a turn-on leaves them out.
function prepareAdoption(f, { full = true, rules = false } = {}) {
  const binding = { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX-' }], store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' },
    required_checks: ['validate'], dependency_updates: { auto_merge: 'off', github_actions: 'owner' } };
  fs.mkdirSync(path.join(f.cwd, '.github'), { recursive: true });
  fs.writeFileSync(path.join(f.cwd, governance.BINDING_FILE), JSON.stringify(binding));
  if (rules) {
    fs.writeFileSync(path.join(f.cwd, 'AGENTS.md'), managedAgentsCopy());
    fs.writeFileSync(path.join(f.cwd, 'CLAUDE.md'), '@AGENTS.md\n');
    fs.mkdirSync(path.join(f.cwd, 'docs/agent-playbooks'), { recursive: true });
    fs.writeFileSync(path.join(f.cwd, 'docs/agent-playbooks/INDEX.md'), '# Project playbooks\n');
  }
  if (full) {
    const { REQUIRED_FILES } = require('../scripts/toolkit-governance-proposal.cjs');
    for (const name of REQUIRED_FILES.filter(entry => !fs.existsSync(path.join(f.cwd, entry)))) {
      fs.mkdirSync(path.dirname(path.join(f.cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(f.cwd, name), `${name}\n`);
    }
  }
  return binding;
}
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
test('a yes proposal leaves out the retired schedule_folder key, from a v1 or v2 binding, and keeps a binding without it as it is', t => {
  const f = fixture(t), yes = f.owner.request(f.cwd, 'yes', run);
  const v2 = prepareAdoption(f);
  const v1 = { schema: 'toolkit.programme-binding.v1', repository: v2.repository, parent_issue: 1, record_prefix: 'INT-FX-', store: v2.store, required_checks: ['validate'] };
  for (const binding of [v2, v1]) {
    const plain = f.owner.prepare(f.cwd, yes.run, binding);
    const carried = f.owner.prepare(f.cwd, yes.run, { ...binding, schedule_folder: 'TOOLKIT' });
    assert.equal(Object.hasOwn(carried.binding, 'schedule_folder'), false, binding.schema);
    assert.deepEqual(carried.binding, plain.binding, `${binding.schema}: nothing else changes`);
    assert.equal(carried.text, plain.text, `${binding.schema}: the programme file the pull request carries is the same`);
  }
  assert.equal(f.owner.prepare(f.cwd, yes.run, v2).binding, v2, 'a v2 binding without the key is used as it is');
});
test('publication discovers, writes once and reads back; another chat sees the pending PR', t => {
  let open = [], writes = 0;
  const f = fixture(t, { list: () => open, publish() { writes++; open = [proposal()]; return open[0]; }, read: () => open[0] });
  const request = f.owner.request(f.cwd, 'no', run);
  // The agent runs the merge in the same turn so the merge hold is the only ask, never a question of its own first.
  assert.match(f.owner.publish(f.cwd, request.run).text, /run its merge in the same turn: Toolkit's merge hold asks the owner, so ask no merge question of your own first\./);
  // Checks still running are waited for, never a reason to ask (owner UAT, 28 November 2026).
  assert.match(f.owner.publish(f.cwd, request.run).text, /ask no merge question of your own first\. If its checks are still running, wait for them in one background wait, then run the merge; ask only if a check fails or the merge is refused for a reason other than Toolkit's merge card\. This answer grants no merge permission\./);
  f.owner.publish(f.cwd, request.run);
  assert.equal(writes, 1);
  assert.equal(f.owner.pending(f.cwd, { ...run, sessionId: 'new-chat' }).kind, 'published');
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'UNDECIDED');
  open = [];
  assert.throws(() => f.owner.publish(f.cwd, request.run), /RECEIPT_REQUIRED/);
  assert.equal(writes, 1, 'rerunning publication after closure never reopens the proposal');
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
  const unavailable = new gate.GovernanceGate(f.options).evaluate(f.cwd);
  assert.deepEqual([unavailable.open, unavailable.reason], [false, 'unavailable'], 'no question is asked while GitHub cannot be read');
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
  assert.deepEqual([new gate.GovernanceGate(f.options).evaluate(f.cwd).open, new gate.GovernanceGate(f.options).evaluate(f.cwd).reason], [false, 'decided']);
  assert.equal(fs.readFileSync(f.registryPath, 'utf8'), '{damaged');
});
test('being asked is same run only; a concurrent chat is asked itself and does not invalidate the first', t => {
  const f = fixture(t), options = { registryOptions: f.registryOptions, environment: {} };
  gate.startSession({ cwd: f.cwd, session_id: 'owner', source: 'startup' }, options);
  const hold = new gate.PromptHold(options);
  const first = hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'Do this work' });
  assert.equal(first.action, 'pass');
  assert.match(first.context, /Turn on GitHub governance/);
  gate.startSession({ cwd: f.cwd, session_id: 'other', source: 'startup' }, options);
  const later = hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'later' });
  assert.equal(later.action, 'pass');
  assert.match(later.context, / ANSWER [0-9a-f]{32}\n/, 'the other chat starting does not cost the owner their reply');
  assert.equal(new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'owner' }).reason, 'asked');
  assert.equal(new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'other' }).reason, 'undecided');
  assert.equal(hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'toolkit governance disable' }).action, 'pass');
  assert.equal(new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'owner' }).reason, 'pending');
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
  // The off decision's merge runs once its checks pass, with no question of the agent's own meanwhile.
  assert.match(f.owner.pending(f.cwd, run).text, /Toolkit's merge hold asks the owner\. If its checks are still running, wait for them in one background wait, then run the merge; ask only if a check fails or the merge is refused for a reason other than Toolkit's merge card\./);
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
    { truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] },
    { truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
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
    { truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] },
    { truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
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
    { truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] },
    { truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] },
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

test('real runner handles large GitHub responses, projects the PR list and reads only shallow trees', t => {
  const f = fixture(t), github = fakeGitHub(f, { large: true });
  const owner = new GovernanceProposals({ registryOptions: f.registryOptions, transport: github.transport });
  const request = owner.request(f.cwd, 'no', run);
  assert.equal(owner.publish(f.cwd, request.run).proposal.answer, 'no');
  assert.equal(owner.refresh(f.cwd).proposals.length, 1);
  const calls = github.read().calls;
  const lists = calls.filter(call => call.args[1].includes('/pulls?'));
  assert.ok(lists.length >= 2);
  assert.ok(lists.every(call => call.args.includes('--jq') && call.args.at(-1).includes('marked')));
  assert.ok(calls.some(call => call.args[1].includes('/contents/.github/toolkit-programme.json?ref=')));
  assert.ok(!calls.some(call => call.args.join(' ').includes('recursive=')));
});

test('first yes opens the guided setup, a hand-built yes is refused, and the setup publishes one complete marked adoption', async t => {
  const f = fixture(t), github = fakeGitHub(f);
  const options = { registryOptions: f.registryOptions, environment: {}, proposalTransport: github.transport };
  gate.startSession({ cwd: f.cwd, session_id: 'owner', source: 'startup' }, options);
  const hold = new gate.PromptHold(options);
  assert.equal(hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'Do this work' }).action, 'pass');
  // The owner's "yes" reaches the agent with a reply ticket; it records nothing and opens the guided setup.
  const reply = hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'yes' });
  assert.equal(reply.action, 'pass');
  const answer = hold.answerTicket((/ ANSWER ([0-9a-f]{32})\n/.exec(reply.context) || [])[1], 'yes');
  assert.equal(answer.ok, true, answer.text);
  assert.match(answer.text, /guided setup/);
  assert.match(answer.text, /toolkit-governance\.cjs" setup/);
  assert.match(answer.text, /Build nothing by hand/);
  assert.doesNotMatch(answer.text, /repository-agent-rules|publish --run|governance discover/);
  const epoch = new gate.SessionEpochs(options).get('owner');
  assert.equal(f.owner.pending(f.cwd, { sessionId: 'owner', epoch }), null, 'a yes leaves no receipt to publish by hand');
  const stdout = [], stderr = [];
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const answers = [];
  // The render result is set here, never left to where this checkout's commit sits: the prepared copies travel as they are.
  const cli = new ToolkitGovernanceCli({ cwd: f.cwd, registryOptions: f.registryOptions, proposalTransport: github.transport, cloudWorkflows: () => ({ files: {}, warning: null }),
    stdout: { write: text => stdout.push(text) }, stderr: { write: text => stderr.push(text) },
    discoveryGh: () => ({ ok: false, reason: 'offline' }), interactive: true, environment: {}, ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }) });
  // A yes receipt from an older Toolkit is never published by an agent's publish --run.
  const stale = f.owner.request(f.cwd, 'yes', run);
  const binding = prepareAdoption(f, { full: false, rules: true });
  assert.equal(await cli.main(['publish', '--run', stale.run]), 2);
  assert.match(stderr.join(''), /published only from the guided governance setup/);
  assert.equal(github.read().calls.filter(call => call.input).length, 0, 'a hand-built yes causes no GitHub writes');
  // A working tree prepared with the programme file and the instruction copies older turn-ons wrote:
  // the bank adds the plain-text check and carries the binding and CI files only. The installed
  // Toolkit delivers the governed rules, so AGENTS.md, CLAUDE.md and the playbooks stay out.
  require('node:child_process').execFileSync('git', ['init', '--quiet', f.cwd], { stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(path.join(f.cwd, 'AGENTS.md'), fs.readFileSync(path.join(f.cwd, 'AGENTS.md'), 'utf8').replace(/\r?\n/g, '\r\n'));
  fs.writeFileSync(path.join(f.cwd, 'product.txt'), 'Unrelated work\n');
  answers.push('all recommended');
  { const code = await cli.main(['setup']); assert.equal(code, 0, stdout.join('').slice(-1500) + stderr.join('')); }
  answers.push('all recommended');
  assert.equal(await cli.main(['setup']), 0, 'answering again reuses the same proposal');
  const published = github.read();
  assert.equal(published.commits, 1);
  assert.equal(published.calls.filter(call => call.args[1].endsWith('/pulls') && call.input).length, 1);
  assert.match(published.pr.body, /<!-- toolkit-governance-decision -->/);
  const { REQUIRED_FILES } = require('../scripts/toolkit-governance-proposal.cjs');
  assert.deepEqual(Object.keys(published.files).sort(), ['.github/plain-text-baseline.json', '.github/dependabot.yml', ...REQUIRED_FILES].sort(), 'the binding, the CI checks and the Dependabot settings, and nothing else (no cloud copies are rendered here)');
  // The installer's own files travel, rendered outside the checkout: none of them is written to it.
  const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
  assert.equal(published.files['.github/plain-text.json'], `${JSON.stringify(installer.STARTING_CONFIG, null, 2)}\n`);
  assert.equal(published.files['.github/workflows/plain-text.yml'], fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'templates', 'github-actions', 'plain-text.yml'), 'utf8').replace(/\r\n/g, '\n'));
  for (const name of [...REQUIRED_FILES.filter(entry => entry !== governance.BINDING_FILE), '.github/plain-text-baseline.json', '.github/dependabot.yml']) assert.equal(fs.existsSync(path.join(f.cwd, name)), false, `not in the checkout: ${name}`);
  // All recommended writes task auto-merge with merge train on with the turn-on, and requires the
  // plain-text check its own workflow adds next to the check the prepared binding names.
  assert.deepEqual(JSON.parse(published.files[governance.BINDING_FILE]), { ...binding, required_checks: ['plain-text', 'validate'], task_prs: { auto_merge: 'after-gates', merge_train: 'on' } });
  // The fixed summary: what merging does, what the pull request holds and what finishes after the merge,
  // then one closing line after the owner's commands.
  const said = stdout.join('');
  assert.match(said, /prepared the governance turn-on pull request: https:\/\/github\.com\/example-owner\/example-repo\/pull\/1\./);
  assert.match(said, /It holds: \.github\/toolkit-programme\.json, .*\.github\/workflows\/plain-text\.yml/);
  assert.doesNotMatch(said, /It holds: .*(AGENTS|CLAUDE)\.md/, 'no instruction copies');
  assert.match(said, /After the merge, Toolkit finishes the setup on its own: default-branch protection/);
  assert.doesNotMatch(said, /no required checks yet/, 'a binding with required checks has no protection wait line');
  assert.match(said, /^Nothing was written to your checkout, so after the merge the next session here can bring your local default branch up to date on its own\.$/m);
  assert.doesNotMatch(said, /before pulling|untracked files/, 'no pull step for the owner');
  assert.match(said, /Next: once its checks pass, approve merging https:\/\/github\.com\/example-owner\/example-repo\/pull\/1 when Toolkit asks\. Toolkit then finishes the setup and gives you two commands to run\.\n*$/);
  assert.match(said, /already holds these answers/, 'the same answers again leave the open pull request as it is');
  // The owner's App and permissions commands come in the summary after the merge, never here.
  assert.doesNotMatch(stdout.join(''), /toolkit-governance-app-setup\.cjs/);
  assert.doesNotMatch(stdout.join(''), /github\.com\/settings\/apps\/new\?/);
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'UNDECIDED');
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).programme_records_bind, false);
  const other = new GovernanceProposals({ registryOptions: { registryPath: path.join(f.root, 'other-home/state.json'), testOnly: true }, transport: github.transport });
  other.refresh(f.cwd);
  assert.equal(other.pending(f.cwd).kind, 'published', 'another computer discovers the complete adoption');
  recordMerged(f.cwd, { registryPath: f.registryPath });
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'ENABLED');
  const started = [];
  const line = gate.sessionLine(f.cwd, { ...options, programmeDeps: { startFinish: root => started.push(root) } });
  assert.match(line, /ENABLED for this repository[\s\S]*# Toolkit-Governed Repository Rules/);
  // The bank's turn-on was noted as finish pending, so the first session after the merge starts the
  // remaining GitHub settings in the background, once, and says so.
  assert.match(line, /the governance turn-on is merged, so Toolkit is finishing its setup in the background: default-branch protection/);
  assert.equal(started.length, 1);
  assert.doesNotMatch(gate.sessionLine(f.cwd, { ...options, programmeDeps: { startFinish: root => started.push(root) } }), /finishing its setup/, 'not started again while it runs');
  assert.equal(started.length, 1);
});

test('a re-run with new answers while the turn-on pull request is open updates that pull request, and never a branch someone changed', async t => {
  const f = fixture(t), github = fakeGitHub(f);
  prepareAdoption(f);
  require('node:child_process').execFileSync('git', ['init', '--quiet', f.cwd], { stdio: 'ignore', windowsHide: true });
  const stdout = [], answers = [];
  // The first answer's render carries a workflow copy (an older Toolkit's test shards copy); the later
  // answers no longer make it.
  const SHARDS = '.github/workflows/toolkit-test-shards.yml';
  let rendered = { [SHARDS]: `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED test-shards toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\nname: shards\n` };
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const cli = new ToolkitGovernanceCli({ cwd: f.cwd, registryOptions: f.registryOptions, proposalTransport: github.transport, cloudWorkflows: () => ({ files: rendered, warning: null }),
    stdout: { write: text => stdout.push(text) }, stderr: { write: text => stdout.push(text) },
    discoveryGh: () => ({ ok: false, reason: 'offline' }), interactive: true, environment: {}, ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }) });
  // The prepared programme file names the store, so the questions are governance (1) and task auto-merge (2).
  answers.push('1A 2B');
  assert.equal(await cli.main(['setup']), 0, stdout.join(''));
  assert.equal(JSON.parse(github.read().files[governance.BINDING_FILE]).task_prs.auto_merge, 'off');
  assert.ok(github.read().files[SHARDS], 'the first answer carries the workflow copy');
  rendered = {};
  // A workflow someone else pushed to the turn-on branch is not Toolkit's copy, so it stays.
  const MINE = '.github/workflows/mine.yml';
  // GitHub also shows the earlier head for one read after the branch moves; the read-back waits for it.
  fs.writeFileSync(path.join(f.root, 'github.json'), JSON.stringify({ ...github.read(), lag: 1, files: { ...github.read().files, [MINE]: 'name: mine\n' } }));
  // This answer also sets task auto-merge on.
  answers.push('1A 2A');
  assert.equal(await cli.main(['setup']), 0, stdout.join(''));
  const published = github.read();
  assert.equal(published.calls.filter(call => call.args[1].endsWith('/pulls') && call.input).length, 1, 'still one pull request');
  assert.equal(published.commits, 2, 'the new answer is one more commit on the same branch');
  assert.equal(JSON.parse(published.files[governance.BINDING_FILE]).task_prs.auto_merge, 'after-gates', 'the open pull request carries the new answer');
  assert.match(published.pr.body, /<!-- toolkit-governance-decision -->/);
  // Files the new answers no longer make leave the pull request, and its description says so.
  assert.equal(published.files[SHARDS], undefined, 'the workflow copy left the pull request');
  assert.match(published.pr.body, /No longer in this pull request[^]*toolkit-test-shards\.yml/);
  assert.equal(published.files[MINE], 'name: mine\n', 'a workflow without the Toolkit marker is left on the branch');
  assert.doesNotMatch(published.pr.body, /mine\.yml/);
  assert.match(stdout.join(''), /updated the open governance turn-on pull request with these answers: https:\/\/github\.com\/example-owner\/example-repo\/pull\/1\./);
  // A branch that also holds a file Toolkit did not put there is not ours to change.
  fs.writeFileSync(path.join(f.root, 'github.json'), JSON.stringify({ ...published, foreign: 'product.txt' }));
  answers.push('all recommended');
  assert.equal(await cli.main(['setup']), 2);
  assert.equal(github.read().commits, 2, 'nothing was pushed to a changed branch');
});

for (const permission of ['write', 'read-only', 'unavailable']) test(`startup permission ${permission}: only a verified writer is asked for a decision`, t => {
  const f = fixture(t);
  const transport = { canWrite() { if (permission === 'unavailable') throw Error('no login'); return permission === 'write'; }, list: () => [] };
  const options = { registryOptions: f.registryOptions, environment: {}, proposalTransport: transport };
  gate.startSession({ cwd: f.cwd, session_id: 'owner', source: 'startup' }, options);
  const verdict = new gate.GovernanceGate(options).evaluate(f.cwd, { sessionId: 'owner' });
  assert.equal(verdict.open, permission === 'write');
  assert.equal(verdict.state.programme_records_bind, false);
  if (permission === 'read-only') {
    assert.match(gate.sessionLine(f.cwd, options), /account cannot write/);
    const report = require('../scripts/toolkit-governance-conformance.cjs').checkConformance(f.cwd, { ...f.registryOptions, offline: true });
    assert.equal(report.exit_code, 0);
    assert.deepEqual(report.findings.map(item => item.id), ['READ_ONLY_ACCOUNT']);
  }
  if (permission === 'unavailable') assert.match(gate.sessionLine(f.cwd, options), /couldn't check/);
});

for (const closed of ['merged', 'unmerged']) test(`next prompt after ${closed} closure stops the old merge request, without network on tools`, t => {
  let open = [proposal()], reads = 0, refreshes = 0;
  const transport = { list() { reads++; return open; }, state() { reads++; return open.length ? 'open' : 'closed'; }, publish: () => proposal(), read: () => proposal() };
  const f = fixture(t, transport);
  const request = f.owner.request(f.cwd, 'no', run);
  f.owner.publish(f.cwd, request.run);
  const options = { registryOptions: f.registryOptions, environment: {}, proposalTransport: transport, refreshBinding() {
    refreshes++;
    if (closed === 'merged') seedMerged(f.cwd, 'disable', f.options);
  } };
  const initialReads = reads;
  new gate.GovernanceGate(options).evaluate(f.cwd);
  assert.equal(reads, initialReads, 'tool evaluation uses the cached observation');
  open = [];
  const result = new gate.PromptHold(options).decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'Continue the work' });
  assert.equal(refreshes, 1);
  assert.equal(reads, initialReads + 1, 'prompt reads only the known PR state');
  assert.ok(!JSON.stringify(result).includes('run its merge in the same turn'));
  assert.equal(result.action, 'pass', 'nothing is held either way');
  assert.equal(String(result.context).includes('no governance decision yet, so it counts as off'), closed === 'unmerged', 'closed without merging: undecided again, and the agent is told so');
  assert.equal(f.owner.pending(f.cwd, run), null);
});

test('real PR-state runner accepts only bare open or closed, with surrounding whitespace trimmed', t => {
  for (const state of ['open', 'closed', '"open"', '"closed"', 'merged', 'OPEN', '', null, {}, ['open'], true, 1]) {
    const f = fixture(t), github = fakeGitHub(f, { pr: { state } });
    const read = () => github.transport.state('example-owner/example-repo', 1, { deadline: Date.now() + 3000 });
    if (state === 'open' || state === 'closed') assert.equal(read(), state);
    else assert.throws(read, /PROPOSAL_GITHUB_UNAVAILABLE/, JSON.stringify(state));
  }
});

for (const { state, delayMs } of [{ state: 'open', delayMs: 0 }, { state: 'closed', delayMs: 0 }, { state: 'open', delayMs: 15000 }]) test(`real prompt runner: ${delayMs ? 'slow GitHub times out with a note' : `${state} PR uses one state read`}, throttled across chats`, t => {
  const f = fixture(t, { list: () => [proposal()] });
  f.owner.refresh(f.cwd);
  const github = fakeGitHub(f, { pr: { state }, delayMs });
  let refreshes = 0;
  const options = { registryOptions: f.registryOptions, environment: {}, proposalTransport: github.transport,
    refreshBinding() { refreshes++; seedMerged(f.cwd, 'disable', f.options); } };
  const started = performance.now();
  const result = new gate.PromptHold(options).decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'merge 1' });
  assert.ok(performance.now() - started < 5000, 'prompt remains well inside the host ten-second limit');
  assert.equal(result.action, 'pass');
  if (state === 'closed') assert.doesNotMatch(JSON.stringify(result), /couldn't check|run its merge in the same turn/);
  else assert.match(result.context, delayMs ? /couldn't check/ : /run its merge in the same turn/);
  assert.equal(refreshes, state === 'closed' ? 1 : 0);
  const second = new gate.PromptHold(options).decide({ cwd: f.cwd, sessionId: 'other', prompt: 'Continue' });
  assert.equal(second.action, 'pass');
  if (state === 'closed') assert.doesNotMatch(JSON.stringify(second), /couldn't check|run its merge in the same turn/);
  assert.equal(refreshes, state === 'closed' ? 1 : 0, 'closure refreshes the branch exactly once');
  const calls = github.read().calls;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['api', 'repos/example-owner/example-repo/pulls/1', '--jq', '.state']);
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).programme_records_bind, false);
  if (delayMs) {
    const later = new GovernanceProposals({ registryOptions: f.registryOptions, transport: { state: () => 'open' }, now: () => new Date(Date.now() + 61000) });
    assert.equal(later.refreshPrompt(f.cwd, Date.now() + 3000).ok, true);
    assert.equal(later.pending(f.cwd).kind, 'published', 'a later successful read clears the timeout note');
  }
});

test('a busy proposal lock allows the prompt with a note, keeping the receipt intact', t => {
  const f = fixture(t, { list: () => [proposal()] });
  f.owner.refresh(f.cwd);
  const directory = path.join(f.home, '.ai-agent-toolkit/user-state/governance-proposals');
  const file = path.join(directory, fs.readdirSync(directory)[0]), before = fs.readFileSync(file);
  fs.writeFileSync(`${file}.lock`, '');
  const result = new gate.PromptHold({ registryOptions: f.registryOptions, environment: {}, proposalTransport: { state() { throw Error('must not query while locked'); } } })
    .decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'merge 1' });
  assert.equal(result.action, 'pass');
  assert.match(result.context, /couldn't check/);
  assert.deepEqual(fs.readFileSync(file), before);
});

// The installed Toolkit delivers the governed rules, so a repository needs no copy of them.
const GOVERNED_RULES = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'agent-rules', 'toolkit-governed-rules.md'), 'utf8').replace(/\r\n/g, '\n').trim();
const TOOLKIT_VERSION = require('../contracts/toolkit-local-bridge/version.json').version;

test('an enabled repository with no governed block gets the governed rules from the installed Toolkit', t => {
  const f = fixture(t);
  seedMerged(f.cwd, 'enable', f.options);
  const line = gate.sessionLine(f.cwd, f.options);
  assert.match(line, /^Toolkit governance: ENABLED for this repository\./);
  assert.equal(line.split(GOVERNED_RULES).length, 2, 'the whole governed rules text, once');
  assert.ok(line.includes(`Toolkit ${TOOLKIT_VERSION}`));
  assert.doesNotMatch(line, /no governed rules block|repository-agent-rules/);
});

test('disabled, undecided and evidence-store repositories get no governed rules', t => {
  const disabled = fixture(t);
  seedMerged(disabled.cwd, 'disable', disabled.options);
  const undecided = fixture(t);
  for (const f of [disabled, undecided]) {
    const line = gate.sessionLine(f.cwd, f.options);
    assert.ok(!line.includes(GOVERNED_RULES.slice(0, 80)), line);
    assert.doesNotMatch(line, /ENABLED/);
  }
});

test('pending conformance reports the existing proposal rather than asking for another answer', t => {
  const f = fixture(t, { list: () => [proposal()] });
  f.owner.refresh(f.cwd);
  const report = require('../scripts/toolkit-governance-conformance.cjs').checkConformance(f.cwd, { ...f.registryOptions, offline: true });
  const pending = report.findings.find(item => item.id === 'DECISION_PENDING');
  assert.match(pending.message, /governance decision pending/);
  assert.ok(!pending.message.includes('You have not decided'));
});

test('publication errors explain read-only access, conflicting proposals and expired receipts plainly', async t => {
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  for (const [code, pattern] of [
    ['PROPOSAL_WRITE_REQUIRED', /account cannot write/],
    ['PROPOSAL_CONFLICT', /Conflicting governance proposals/],
    ['PROPOSAL_RECEIPT_REQUIRED', /No live pending owner answer/],
  ]) {
    const transport = { canWrite: () => code !== 'PROPOSAL_WRITE_REQUIRED', list: () => code === 'PROPOSAL_CONFLICT' ? [proposal(), proposal('yes', 2)] : [] };
    const f = fixture(t, transport), request = f.owner.request(f.cwd, 'no', run);
    if (code === 'PROPOSAL_RECEIPT_REQUIRED') {
      const directory = path.join(f.home, '.ai-agent-toolkit/user-state/governance-proposals');
      const file = path.join(directory, fs.readdirSync(directory)[0]);
      const value = JSON.parse(fs.readFileSync(file));
      value.requests[0].proposal = 1;
      fs.writeFileSync(file, JSON.stringify(value));
    }
    const stdout = [], stderr = [];
    const cli = new ToolkitGovernanceCli({ cwd: f.cwd, registryOptions: f.registryOptions, proposalTransport: transport,
      stdout: { write: text => stdout.push(text) }, stderr: { write: text => stderr.push(text) } });
    assert.equal(await cli.main(['publish', '--run', request.run]), 2);
    assert.match(stderr.join(''), pattern, code);
    assert.doesNotMatch(stderr.join(''), /unexpected problem|Restore GitHub access|PROPOSAL_/);
  }
});

test('shallow binding reads still refuse symlinks, non-files and truncated trees', () => {
  const repository = 'example-owner/example-repo';
  for (const damage of ['directory-symlink', 'binding-symlink', 'binding-tree', 'truncated']) {
    const responses = [
      { state: 'open', body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: repository }, sha: 'a'.repeat(40) }, base: { ref: 'main' } },
      { default_branch: 'main' }, { tree: { sha: 'b'.repeat(40) } },
      { tree: [{ path: '.github', type: damage === 'directory-symlink' ? 'blob' : 'tree', mode: damage === 'directory-symlink' ? '120000' : '040000', sha: 'd'.repeat(40) }], truncated: damage === 'truncated' },
      { tree: [{ path: 'toolkit-programme.json', type: damage === 'binding-tree' ? 'tree' : 'blob', mode: damage === 'binding-symlink' ? '120000' : '040000' }], truncated: false },
    ];
    const transport = new GitHubProposalTransport({ run: () => JSON.stringify(responses.shift()) });
    assert.throws(() => transport.read(repository, 1), /PROPOSAL_(BINDING_NOT_REGULAR|TREE_UNREADABLE)/, damage);
  }
});

test('yes carries fresh cloud sweep copies with the binding, moves a v1 binding to v2, and names a copy it could not render', t => {
  const { bindingV2 } = require('../scripts/toolkit-governance-proposal.cjs');
  const { SWEEPS } = require('./support/default-cloud-workflows.cjs');
  const programme = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const v1 = { schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1, record_prefix: 'INT-FX-', writer_prefix: 'INT-FX-',
    store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const v2 = bindingV2(v1);
  assert.deepEqual(v2, { schema: 'toolkit.programme-binding.v2', repository: v1.repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-', writer_prefix: 'INT-FX-' }], store: v1.store, required_checks: ['validate'] });
  programme.validateBinding(v2);
  assert.equal(bindingV2(v2), v2, 'a v2 binding is kept as it is');
  for (const [cloud, expectWarning] of [[{ files: Object.fromEntries(SWEEPS.map(row => [row.file, `# copy of ${row.id}\n`])), warning: null }, false], [{ files: {}, warning: 'Toolkit: the cloud sweep copies were not refreshed in this pull request (reason). To fix it, run it.' }, true]]) {
    let published = null;
    const transport = { list: () => published ? [proposal('yes')] : [], publish(repository, binding, files) { published = { binding, files }; return proposal('yes'); }, read: () => proposal('yes') };
    const f = fixture(t, transport);
    const owner = new GovernanceProposals({ ...f.options, cloudWorkflows: () => cloud });
    prepareAdoption(f, { rules: true });
    fs.writeFileSync(path.join(f.cwd, governance.BINDING_FILE), JSON.stringify(v1));
    const request = owner.request(f.cwd, 'yes', run);
    const result = owner.publish(f.cwd, request.run, v1);
    assert.equal(published.binding.schema, 'toolkit.programme-binding.v2');
    assert.equal(JSON.parse(published.files['.github/toolkit-programme.json']).schema, 'toolkit.programme-binding.v2');
    assert.equal(published.files['AGENTS.md'], undefined, 'the governed rules come from the installed Toolkit, not a repository copy');
    for (const row of SWEEPS) assert.equal(published.files[row.file], cloud.files[row.file], row.file);
    assert.equal(result.warning, expectWarning ? cloud.warning : undefined);
  }
  // No receipt reaches the renderer when the answer is no.
  let rendered = 0;
  const f = fixture(t, { list: () => [], publish: () => proposal('no'), read: () => proposal('no') });
  const owner = new GovernanceProposals({ ...f.options, cloudWorkflows: () => { rendered++; return { files: {}, warning: null }; } });
  owner.publish(f.cwd, owner.request(f.cwd, 'no', run).run);
  assert.equal(rendered, 0);
});

test('a yes publishes the binding and CI files with no instruction copies, and is refused without a CI file', t => {
  const { missingFiles, REQUIRED_FILES } = require('../scripts/toolkit-governance-proposal.cjs');
  let published = null;
  const f = fixture(t, { list: () => published ? [proposal('yes')] : [], publish(repository, binding, files) { published = files; return proposal('yes'); }, read: () => proposal('yes') });
  const owner = new GovernanceProposals({ ...f.options, cloudWorkflows: () => ({ files: {}, warning: null }) });
  const binding = prepareAdoption(f);
  fs.rmSync(path.join(f.cwd, '.github/workflows/plain-text.yml'));
  assert.throws(() => owner.publish(f.cwd, owner.request(f.cwd, 'yes', run).run, binding), /PROPOSAL_ADOPTION_INCOMPLETE/);
  assert.equal(published, null, 'a set missing a CI file is never published');
  prepareAdoption(f);
  // A folder in a cloud workflow's place is left out and stops nothing; in a required file's place it does.
  fs.mkdirSync(path.join(f.cwd, '.github/personal-data-guard.json'));
  owner.publish(f.cwd, owner.request(f.cwd, 'yes', { ...run, sessionId: 'again' }).run, binding);
  assert.deepEqual(Object.keys(published).sort(), [...REQUIRED_FILES].sort(), 'no AGENTS.md, CLAUDE.md or playbooks are needed');
  fs.rmSync(path.join(f.cwd, '.github/plain-text.json'));
  fs.mkdirSync(path.join(f.cwd, '.github/plain-text.json'));
  published = null;
  assert.throws(() => owner.publish(f.cwd, owner.request(f.cwd, 'yes', { ...run, sessionId: 'third' }).run, binding), /PROPOSAL_ADOPTION_INCOMPLETE/);
  assert.equal(published, null);
  const full = Object.fromEntries(REQUIRED_FILES.map(name => [name, 'x']));
  assert.deepEqual(missingFiles(full), []);
  const { '.github/workflows/plain-text.yml': dropped, ...partial } = full;
  assert.ok(dropped);
  assert.deepEqual(missingFiles(partial), ['.github/workflows/plain-text.yml']);
});

test('the default renderer leaves a Toolkit source checkout alone, makes every default workflow, and names a reason and fix when it cannot', t => {
  const { cloudWorkflowFiles } = require('../scripts/toolkit-governance-proposal.cjs');
  const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
  const { COPIED_FILES, SWEEPS } = require('./support/default-cloud-workflows.cjs');
  assert.deepEqual(cloudWorkflowFiles(path.join(__dirname, '..', '..')), { files: {}, warning: null });
  // The commit is set here, so the result never depends on whether this checkout's HEAD is on origin/main.
  const commit = workflows.toolkitHead();
  const f = fixture(t);
  const rendered = cloudWorkflowFiles(f.cwd, { commit });
  assert.equal(rendered.warning, null);
  assert.deepEqual(Object.keys(rendered.files).sort(), [...SWEEPS.map(row => row.file), ...COPIED_FILES].sort());
  for (const row of SWEEPS) assert.match(rendered.files[row.file], new RegExp(`^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED [a-z-]+ toolkit=${commit} `, 'm'));
  // A same-named file that is not a Toolkit copy stops the render, with the reason and the fix.
  const [sweep] = SWEEPS.map(row => row.file);
  fs.mkdirSync(path.join(f.cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(f.cwd, ...sweep.split('/')), 'name: my own sweep\n');
  const refused = cloudWorkflowFiles(f.cwd, { commit });
  assert.deepEqual(refused.files, {});
  assert.match(refused.warning, /cloud workflow copies were not refreshed in this pull request \(.*is not a Toolkit copy; move it aside first\)\. To fix it, run node repo\/scripts\/toolkit-cloud-workflows\.cjs --repo/);
  // A folder that is not a git checkout stops it too.
  assert.match(cloudWorkflowFiles(path.join(f.root, 'empty'), { commit }).warning || '', /not refreshed/);
});

test('answering again updates the open turn-on branch, and guard settings already on it stay as they are', () => {
  const repository = 'example-owner/example-repo', config = '.github/personal-data-guard.json', script = '.github/scripts/personal-data-guard.cjs';
  const { REQUIRED_FILES } = require('../scripts/toolkit-governance-proposal.cjs');
  const binding = { schema: 'toolkit.programme-binding.v2', repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-' }], store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const text = JSON.stringify(binding);
  const files = { ...Object.fromEntries(REQUIRED_FILES.map(name => [name, `new ${name}\n`])), [config]: 'the Toolkit default\n', [script]: 'new guard\n' };
  const held = { ...Object.fromEntries(Object.keys(files).map(name => [name, 'old\n'])), '.github/toolkit-programme.json': text, [config]: 'the owner\'s own\n', [script]: require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs').vendoredText('#!/usr/bin/env node\n// an older guard\n') };
  let tree = null;
  const json = value => JSON.stringify(value), blob = value => ({ type: 'file', encoding: 'base64', content: Buffer.from(value).toString('base64') });
  const transport = new GitHubProposalTransport({ run(args, input) {
    const endpoint = args[1];
    if (args[0] === 'auth') return '';
    if (endpoint === 'user') return json({ login: 'example-owner' });
    if (endpoint === `repos/${repository}`) return json({ default_branch: 'main' });
    if (endpoint.endsWith('/pulls/1')) return input ? '{}' : json({ number: 1, html_url: `https://github.com/${repository}/pull/1`, state: 'open', body: '<!-- toolkit-governance-decision -->', head: { ref: 'toolkit/governance-on-x', repo: { full_name: repository }, sha: 'a'.repeat(40) }, base: { ref: 'main', sha: '9'.repeat(40) } });
    if (endpoint.includes('/compare/')) return json({ merge_base_commit: { sha: '9'.repeat(40) }, files: Object.keys(held).map(filename => ({ filename, status: 'added' })) });
    if (endpoint.includes('/git/commits/')) return json({ tree: { sha: 'b'.repeat(40) } });
    if (endpoint.endsWith(`/git/trees/${'b'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] });
    if (endpoint.endsWith(`/git/trees/${'d'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] });
    if (endpoint.includes('/contents/.github/toolkit-programme.json')) return json({ ...blob(text), sha: 'c'.repeat(40), size: Buffer.byteLength(text) });
    if (endpoint.includes('/contents/')) { const name = /\/contents\/([^?]+)/.exec(endpoint)[1]; if (held[name] === undefined) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' }); return json(blob(held[name])); }
    if (endpoint.endsWith('/git/trees')) { tree = input.tree; return json({ sha: 'e'.repeat(40) }); }
    if (endpoint.endsWith('/git/commits')) return json({ sha: 'f'.repeat(40) });
    if (endpoint.includes('/git/refs/heads/')) return '{}';
    throw Error(`unexpected endpoint ${endpoint}`);
  } });
  assert.deepEqual(transport.update(repository, 1, binding, files), { number: 1, head: 'f'.repeat(40), updated: true, left: [config], notes: [`${config} is already on GitHub with other content, so it is left as it is.`], onBase: [] });
  assert.deepEqual(tree.map(entry => entry.path).sort(), Object.keys(files).filter(name => name !== config).sort());
});

test('no removes the marked cloud sweep copies in the same pull request, and only those', () => {
  const repository = 'example-owner/example-repo';
  const [sweep, gate] = require('./support/default-cloud-workflows.cjs').SWEEPS.map(row => row.file);
  const off = { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' };
  const marked = Buffer.from(`# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\nname: x\n`).toString('base64');
  const shardsCopy = Buffer.from(`# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED test-shards toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\nname: x\n`).toString('base64');
  const calls = [];
  const transport = new GitHubProposalTransport({ run(args, input) {
    calls.push({ args, input }); const endpoint = args[1];
    if (args[0] === 'auth') return '';
    if (endpoint === 'user') return JSON.stringify({ login: 'example-owner' });
    if (endpoint === `repos/${repository}`) return JSON.stringify({ default_branch: 'main' });
    if (endpoint.includes('/git/ref/heads/toolkit/')) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
    if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
    // The folder listing finds the test shards copy at the name its shard list chose.
    if (endpoint.includes('/contents/.github/workflows?ref=')) return JSON.stringify(['ci.yml', 'shards.yml', 'toolkit-programme-sweep.yml', 'notes.txt'].map(name => ({ type: 'file', name })));
    if (endpoint.includes('/contents/.github/workflows/shards.yml')) return JSON.stringify({ type: 'file', encoding: 'base64', content: shardsCopy });
    if (endpoint.includes('/contents/.github/workflows/ci.yml')) return JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from('name: CI\n').toString('base64') });
    if (endpoint.includes('/contents/.github/workflows/toolkit-shard-timings.yml') || endpoint.includes('/contents/.github/workflows/toolkit-test-shards.yml')) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
    if (endpoint.includes(`/contents/${sweep}`)) return JSON.stringify({ type: 'file', encoding: 'base64', content: marked });
    // The gate here is someone's own file with the same name: never removed.
    if (endpoint.includes(`/contents/${gate}`)) return JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from('name: mine\n').toString('base64') });
    if (endpoint.endsWith('/git/commits') && input) return JSON.stringify({ sha: 'c'.repeat(40) });
    if (endpoint.includes('/git/commits/')) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
    if (endpoint.endsWith('/git/trees') && input) return JSON.stringify({ sha: 'e'.repeat(40) });
    if (endpoint.includes('/git/trees/')) return JSON.stringify({ truncated: false, tree: [] });
    if (endpoint.endsWith('/git/refs')) return '{}';
    if (endpoint.includes('/git/refs/heads/')) return '{}';
    if (endpoint.endsWith('/pulls')) return JSON.stringify({ number: 1 });
    throw Error(`unexpected endpoint ${endpoint}`);
  } });
  assert.deepEqual(transport.publish(repository, off), { number: 1, head: 'c'.repeat(40) });
  const tree = calls.find(item => item.args[1].endsWith('/git/trees') && item.input).input.tree;
  assert.deepEqual(tree.map(entry => [entry.path, entry.sha === null ? 'removed' : 'written']), [['.github/toolkit-programme.json', 'written'], [sweep, 'removed'], ['.github/workflows/shards.yml', 'removed']]);
  const body = calls.find(item => item.args[1].endsWith('/pulls') && item.input).input.body;
  const removed = body.slice(body.indexOf('Removed files'));
  assert.ok(body.includes('Removed files') && removed.split('\n')[1] === `- ${sweep}` && removed.split('\n')[2] === '- .github/workflows/shards.yml', body);
  assert.ok(!body.includes('ci.yml'), 'a workflow without the marker is never removed');
  assert.ok(!body.includes(gate), 'the unmarked gate file is never listed');
});

test('an off pull request may remove the marked cloud sweep copies, and nothing else', () => {
  const repository = 'example-owner/example-repo';
  const [sweep, gate] = require('./support/default-cloud-workflows.cjs').SWEEPS.map(row => row.file);
  const text = JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' });
  const marker = `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\nname: x\n`;
  const shards = '.github/workflows/shards.yml', other = '.github/workflows/other.yml';
  const shardsMarker = marker.replace('programme-sweep', 'test-shards');
  // Each copy carries its own id: a marker for another copy at that path is not a Toolkit copy.
  const read = (files, atBase = { [sweep]: marker, [gate]: marker.replace('programme-sweep', 'programme-sweep-gate'), [shards]: shardsMarker, [other]: 'name: mine\n' }) => new GitHubProposalTransport({ run(args) {
    const endpoint = args[1];
    const json = value => JSON.stringify(value);
    if (endpoint.endsWith('/pulls/1')) return json({ number: 1, html_url: `https://github.com/${repository}/pull/1`, state: 'open', changed_files: files.length, body: '<!-- toolkit-governance-decision -->', head: { repo: { full_name: repository }, sha: 'a'.repeat(40) }, base: { ref: 'main', sha: '9'.repeat(40) } });
    if (endpoint === `repos/${repository}`) return json({ default_branch: 'main' });
    if (endpoint.includes('/git/commits/')) return json({ tree: { sha: 'b'.repeat(40) } });
    if (endpoint.endsWith(`/git/trees/${'b'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: '.github', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }] });
    if (endpoint.endsWith(`/git/trees/${'d'.repeat(40)}`)) return json({ truncated: false, tree: [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: 'c'.repeat(40) }] });
    if (endpoint.includes('/contents/.github/toolkit-programme.json')) return json({ type: 'file', sha: 'c'.repeat(40), encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') });
    if (endpoint.includes('/pulls/1/files')) return json(files);
    if (endpoint.includes(`/contents/.github/workflows?ref=${'9'.repeat(40)}`)) return json(Object.keys(atBase).map(name => ({ type: 'file', name: name.split('/').pop() })));
    for (const name of [sweep, gate, shards, other, '.github/workflows/toolkit-shard-timings.yml']) if (endpoint.includes(`/contents/${name}?ref=${'9'.repeat(40)}`)) {
      if (atBase[name] === undefined) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
      return json({ type: 'file', encoding: 'base64', content: Buffer.from(atBase[name]).toString('base64') });
    }
    throw Error(`unexpected endpoint ${endpoint}`);
  } }).read(repository, 1);
  const binding = { filename: '.github/toolkit-programme.json', status: 'modified' };
  assert.equal(read([binding, { filename: sweep, status: 'removed' }, { filename: gate, status: 'removed' }]).answer, 'no');
  assert.equal(read([binding]).answer, 'no');
  assert.equal(read([binding, { filename: shards, status: 'removed' }]).answer, 'no', 'a marked test shards copy at its list\'s own name');
  // A sweep marker at another path is not a copy that may sit there.
  assert.throws(() => read([binding, { filename: shards, status: 'removed' }], { [sweep]: marker, [shards]: marker }), /SCOPE_INVALID/);
  assert.throws(() => read([binding, { filename: sweep, status: 'modified' }]), /SCOPE_INVALID/);
  assert.throws(() => read([binding, { filename: '.github/workflows/other.yml', status: 'removed' }]), /SCOPE_INVALID/);
  assert.throws(() => read([{ filename: sweep, status: 'removed' }]), /SCOPE_INVALID/);
  // A removed sweep path must have held the Toolkit's marked copy at the base: never someone's own file.
  assert.throws(() => read([binding, { filename: gate, status: 'removed' }], { [sweep]: marker, [gate]: 'name: mine\n' }), /SCOPE_INVALID/);
});

test('recovering an interrupted off branch needs every listed removal done, and nothing extra', () => {
  const repository = 'example-owner/example-repo';
  const [sweep, gate] = require('./support/default-cloud-workflows.cjs').SWEEPS.map(row => row.file);
  const binding = { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' };
  const text = `${JSON.stringify(binding, null, 2)}\n`;
  const marked = Buffer.from(`# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${'f'.repeat(40)} sha256=${'0'.repeat(12)}\n`).toString('base64');
  const attempt = diffFiles => {
    const calls = [];
    const transport = new GitHubProposalTransport({ run(args, input) {
      calls.push({ args, input }); const endpoint = args[1];
      if (args[0] === 'auth') return '';
      if (endpoint === 'user') return JSON.stringify({ login: 'example-owner' });
      if (endpoint === `repos/${repository}`) return JSON.stringify({ default_branch: 'main' });
      if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'a'.repeat(40) } });
      if (endpoint.includes('/git/ref/heads/toolkit/')) return JSON.stringify({ object: { sha: 'c'.repeat(40) } });
      if (endpoint.includes(`/contents/${sweep}?ref=`)) return JSON.stringify({ type: 'file', encoding: 'base64', content: marked });
      if (endpoint.includes(`/contents/${gate}?ref=`)) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
      if (endpoint.includes('/contents/.github/workflows?ref=')) return JSON.stringify([{ type: 'file', name: sweep.split('/').pop() }]);
      if (/\/contents\/\.github\/workflows\/toolkit-(test-shards|shard-timings)\.yml\?ref=/.test(endpoint)) throw Object.assign(Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
      if (endpoint.includes('/git/commits/')) return JSON.stringify({ tree: { sha: 'b'.repeat(40) } });
      if (endpoint.includes('/git/trees/')) return JSON.stringify({ truncated: false, tree: [] });
      if (endpoint.includes('/compare/')) return JSON.stringify({ total_commits: 1, merge_base_commit: { sha: 'a'.repeat(40) }, files: diffFiles });
      if (endpoint.includes('/contents/.github/toolkit-programme.json') && !input) return JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') });
      if (endpoint.endsWith('/pulls')) return JSON.stringify({ number: 1 });
      throw Error(`unexpected endpoint ${endpoint}`);
    } });
    const result = (() => { try { return transport.publish(repository, binding); } catch (error) { return error; } })();
    return { result, writes: calls.filter(item => item.input).length };
  };
  const bindingFile = { filename: '.github/toolkit-programme.json', status: 'modified' };
  // Exact branch: the binding and the listed removal.
  const exact = attempt([bindingFile, { filename: sweep, status: 'removed' }]);
  assert.deepEqual(exact.result, { number: 1, head: 'c'.repeat(40) });
  // Binding only: the removal never happened, so the branch is not this proposal.
  const bindingOnly = attempt([bindingFile]);
  assert.match(String(bindingOnly.result.code), /BRANCH_CHANGED/);
  assert.equal(bindingOnly.writes, 0, 'a changed branch receives no writes and no pull request');
  // An extra removal not listed for this base is refused too.
  const extra = attempt([bindingFile, { filename: sweep, status: 'removed' }, { filename: gate, status: 'removed' }]);
  assert.match(String(extra.result.code), /BRANCH_CHANGED/);
  assert.equal(extra.writes, 0);
});

test('a disabled repository turned back on: the turn-on names the post-merge settings before the owner approves the merge, and a binding with no required checks gives the owner no required_checks edit or migrate step', async t => {
  const f = fixture(t);
  recordMerged(f.cwd, { registryPath: f.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' }) });
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'DISABLED');
  const binding = prepareAdoption(f);
  fs.writeFileSync(path.join(f.cwd, governance.BINDING_FILE), JSON.stringify({ ...binding, required_checks: [] }));
  const github = fakeGitHub(f);
  const finishing = require('../scripts/toolkit-governance-finish.cjs');
  const stdout = [], shown = [], answers = ['1B'];
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const cli = new ToolkitGovernanceCli({ cwd: f.cwd, registryOptions: f.registryOptions, proposalTransport: github.transport, cloudWorkflows: () => ({ files: {}, warning: null }),
    stdout: { write: text => stdout.push(text) }, stderr: { write: text => stdout.push(text) },
    discoveryGh: () => ({ ok: false, reason: 'offline' }), interactive: true, environment: {},
    ask: async () => { shown.push(stdout.join('')); return answers.shift() ?? ''; },
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }) });
  assert.equal(await cli.main(['setup']), 0, stdout.join(''));
  assert.match(shown[0], /^\*\*1\. Question: Turn GitHub governance back on for example-owner\/example-repo\?\*\*$/m);
  assert.match(shown[0], /^   - \*\*A\. Keep it off \(my pick\):\*\* /m);
  assert.ok(stdout.join('').slice(shown[0].length).includes(finishing.WHAT), 'the turn-on names what the finish also turns on, before the owner approves the merge');
  const id = governance.readIdentity(f.cwd).repository_id;
  assert.equal(finishing.entryFor(f.registryOptions, id)?.status, 'pending', 'the turn-on is marked for the post-merge finish');
  const after = stdout.join('').slice(shown[0].length);
  assert.doesNotMatch(after, /required_checks|migrate|no required checks yet/, 'Toolkit sets the checks; the owner edits nothing and runs no migrate');
});

// One binding pull request per refresh (G-4e): openRefresh reads only this repository's own Toolkit
// refresh pull request and the checks of Toolkit's own its head defines (G2 round 1, L3).
test('openRefresh reads the repository\'s own refresh pull request and the own checks its head defines', () => {
  const sha = 'a'.repeat(40);
  const base64 = text => Buffer.from(text).toString('base64');
  const guard = 'name: personal-data\non: [pull_request]\njobs:\n  personal-data:\n    runs-on: ubuntu-latest\n';
  const plain = 'name: plain-text\non: [pull_request]\njobs:\n  plain-text:\n    runs-on: ubuntu-latest\n';
  const refresh = (head = {}) => ({ number: 40, html_url: 'https://github.com/acme/app/pull/40', head: { ref: 'toolkit/refresh-cloud-workflows', sha, repo: { full_name: 'acme/app' }, ...head } });
  const read = (pulls, files) => {
    const calls = [];
    const transport = new GitHubProposalTransport({ run(args) {
      calls.push(args.join(' '));
      if (args[0] === 'auth') return '';
      if (args[1] === 'user') return JSON.stringify({ login: 'fixture' });
      if (/\/pulls\?/.test(args[1])) return JSON.stringify(pulls);
      const file = /contents\/(.+)\?ref=(.+)$/.exec(args[1]);
      if (file && file[2] === sha && file[1] in files) return JSON.stringify({ type: 'file', encoding: 'base64', content: base64(files[file[1]]) });
      throw Object.assign(new Error('not found'), { code: 'PROPOSAL_NOT_FOUND' });
    } });
    return { result: transport.openRefresh('acme/app'), calls };
  };
  const both = read([refresh()], { '.github/workflows/personal-data-guard.yml': guard, '.github/workflows/plain-text.yml': plain });
  assert.deepEqual(both.result, { number: 40, url: 'https://github.com/acme/app/pull/40', checks: ['personal-data', 'plain-text'] });
  assert.ok(both.calls.some(call => call.includes('pulls?state=open&head=acme%3Atoolkit%2Frefresh-cloud-workflows')), both.calls.join('\n'));
  assert.ok(both.calls.every(call => !/--method/.test(call)), 'reads only');
  assert.deepEqual(read([refresh()], {}).result.checks, [], 'a refresh that adds no own check');
  assert.equal(read([], {}).result, null, 'no refresh open');
  assert.equal(read([refresh({ repo: { full_name: 'someone/app' } })], { '.github/workflows/personal-data-guard.yml': guard }).result, null, 'a fork\'s branch of the same name is not this repository\'s refresh');
  assert.equal(read([refresh({ sha: 'not-a-sha' })], {}).result, null, 'a head that is not a commit is not read');
});
