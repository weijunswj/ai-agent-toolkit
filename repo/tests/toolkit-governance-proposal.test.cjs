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
function fakeGitHub(f, extra = {}) {
  const file = path.join(f.root, 'github.json');
  fs.writeFileSync(file, JSON.stringify({ repository: 'example-owner/example-repo', calls: [], files: {}, ...extra }));
  return { transport: new GitHubProposalTransport({ command: [process.execPath, path.join(__dirname, 'support/governance-fake-github.cjs'), file] }), read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
function prepareAdoption(f) {
  const binding = { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX-' }], store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' },
    required_checks: ['validate'], dependency_updates: { auto_merge: 'off', github_actions: 'owner' } };
  fs.mkdirSync(path.join(f.cwd, '.github'), { recursive: true });
  fs.writeFileSync(path.join(f.cwd, governance.BINDING_FILE), JSON.stringify(binding));
  fs.copyFileSync(path.join(__dirname, '../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'), path.join(f.cwd, 'AGENTS.md'));
  fs.writeFileSync(path.join(f.cwd, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.mkdirSync(path.join(f.cwd, 'docs/agent-playbooks'), { recursive: true });
  fs.writeFileSync(path.join(f.cwd, 'docs/agent-playbooks/INDEX.md'), '# Project playbooks\n');
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
test('publication discovers, writes once and reads back; another chat sees the pending PR', t => {
  let open = [], writes = 0;
  const f = fixture(t, { list: () => open, publish() { writes++; open = [proposal()]; return open[0]; }, read: () => open[0] });
  const request = f.owner.request(f.cwd, 'no', run);
  assert.match(f.owner.publish(f.cwd, request.run).text, /merge this pull request now/);
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

test('first yes goes from the owner prompt through discovery and real publication as one complete marked adoption', async t => {
  const f = fixture(t), github = fakeGitHub(f);
  const options = { registryOptions: f.registryOptions, environment: {}, proposalTransport: github.transport };
  gate.startSession({ cwd: f.cwd, session_id: 'owner', source: 'startup' }, options);
  const hold = new gate.PromptHold(options);
  assert.equal(hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'Do this work' }).action, 'pass');
  // The owner's "yes" reaches the agent with a reply ticket; recording it starts the adoption.
  const reply = hold.decide({ cwd: f.cwd, sessionId: 'owner', prompt: 'yes' });
  assert.equal(reply.action, 'pass');
  const answer = hold.answerTicket((/ ANSWER ([0-9a-f]{32})\n/.exec(reply.context) || [])[1], 'yes');
  assert.equal(answer.ok, true, answer.text);
  assert.match(answer.text, /governance discover/);
  assert.match(answer.text, /repository-agent-rules/);
  const epoch = new gate.SessionEpochs(options).get('owner');
  const pending = f.owner.pending(f.cwd, { sessionId: 'owner', epoch });
  const stdout = [], stderr = [];
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  // The render result is set here, never left to where this checkout's commit sits: the prepared copies travel as they are.
  const cli = new ToolkitGovernanceCli({ cwd: f.cwd, registryOptions: f.registryOptions, proposalTransport: github.transport, cloudWorkflows: () => ({ files: {}, warning: null }),
    stdout: { write: text => stdout.push(text) }, stderr: { write: text => stderr.push(text) },
    discoveryGh: () => ({ ok: false, reason: 'offline' }) });
  assert.equal(await cli.main(['discover']), 0);
  assert.match(stdout.join(''), /Adoption proposal/);
  assert.equal(await cli.main(['publish', '--run', pending.run]), 2);
  assert.match(stderr.join(''), /adoption proposal is not ready/i);
  assert.ok(!stderr.join('').includes('PROPOSAL_ADOPTION_INCOMPLETE'));
  assert.equal(github.read().calls.filter(call => call.input).length, 0, 'missing materials cause no GitHub writes');
  const binding = prepareAdoption(f);
  const rules = fs.readFileSync(path.join(f.cwd, 'AGENTS.md'));
  fs.rmSync(path.join(f.cwd, 'AGENTS.md'));
  assert.equal(await cli.main(['publish', '--run', pending.run]), 2, 'a binding alone cannot publish adoption');
  assert.equal(github.read().calls.filter(call => call.input).length, 0);
  fs.writeFileSync(path.join(f.cwd, 'AGENTS.md'), rules);
  require('node:child_process').execFileSync('git', ['init', '--quiet', f.cwd], { stdio: 'ignore', windowsHide: true });
  const installed = () => require('node:child_process').execFileSync('git', ['ls-files', '--others', '--exclude-standard', '.github'], { cwd: f.cwd, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
  const beforeInstall = new Set(installed());
  const installerOptions = { repo: f.cwd, out: { write() {} } };
  new (require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs').PlainTextInstaller)(installerOptions).install({ workflow: true });
  new (require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs').GuardInstaller)(installerOptions).install({ identity: 'excluded', identityReason: 'Fixture identity excluded', workflow: true });
  const installerFiles = installed().filter(name => !beforeInstall.has(name));
  assert.equal(installerFiles.length, 7, 'both installers prepared all seven repository files');
  fs.writeFileSync(path.join(f.cwd, 'AGENTS.md'), rules.toString().replace(/\r?\n/g, '\r\n'));
  fs.writeFileSync(path.join(f.cwd, 'product.txt'), 'Unrelated work\n');
  assert.equal(await cli.main(['publish', '--run', pending.run]), 0);
  assert.equal(await cli.main(['publish', '--run', pending.run]), 0, 'retry reuses the same proposal');
  const published = github.read();
  assert.equal(published.commits, 1);
  assert.equal(published.calls.filter(call => call.args[1].endsWith('/pulls') && call.input).length, 1);
  assert.match(published.pr.body, /<!-- toolkit-governance-decision -->/);
  assert.deepEqual(Object.keys(published.files).sort(), ['.github/toolkit-programme.json', 'AGENTS.md', 'CLAUDE.md', 'docs/agent-playbooks/INDEX.md', ...installerFiles].sort());
  for (const name of installerFiles) assert.equal(published.files[name], fs.readFileSync(path.join(f.cwd, name), 'utf8').replace(/\r\n/g, '\n'), name);
  assert.deepEqual(JSON.parse(published.files[governance.BINDING_FILE]), binding);
  assert.equal(published.files['AGENTS.md'], rules.toString().replace(/\r\n/g, '\n'));
  assert.match(stdout.join(''), /Before pulling after merge.*untracked files/);
  // The owner is shown the governance App setup with the decision, not asked for it; offline here.
  assert.match(stdout.join(''), /Governance GitHub App: [^\n]*could not be checked \(offline\)[\s\S]*github\.com\/settings\/apps\/new\?[\s\S]*gh variable set TOOLKIT_GOVERNANCE_APP_CLIENT_ID/);
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'UNDECIDED');
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).programme_records_bind, false);
  const other = new GovernanceProposals({ registryOptions: { registryPath: path.join(f.root, 'other-home/state.json'), testOnly: true }, transport: github.transport });
  other.refresh(f.cwd);
  assert.equal(other.pending(f.cwd).kind, 'published', 'another computer discovers the complete adoption');
  recordMerged(f.cwd, { registryPath: f.registryPath });
  assert.equal(governance.governanceState(f.cwd, f.registryOptions).state, 'ENABLED');
  assert.match(gate.sessionLine(f.cwd, options), /Follow.*TOOLKIT-GOVERNED-RULES/);
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
  assert.ok(!JSON.stringify(result).includes('merge this pull request now'));
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
  if (state === 'closed') assert.doesNotMatch(JSON.stringify(result), /couldn't check|merge this pull request now/);
  else assert.match(result.context, delayMs ? /couldn't check/ : /merge this pull request now/);
  assert.equal(refreshes, state === 'closed' ? 1 : 0);
  const second = new gate.PromptHold(options).decide({ cwd: f.cwd, sessionId: 'other', prompt: 'Continue' });
  assert.equal(second.action, 'pass');
  if (state === 'closed') assert.doesNotMatch(JSON.stringify(second), /couldn't check|merge this pull request now/);
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

test('an enabled repository missing its rules is told to prepare them, never follow an absent block', t => {
  const f = fixture(t);
  seedMerged(f.cwd, 'enable', f.options);
  const line = gate.sessionLine(f.cwd, f.options);
  assert.match(line, /no governed rules block/);
  assert.match(line, /repository-agent-rules/);
  assert.doesNotMatch(line, /Follow.*and the TOOLKIT-GOVERNED-RULES block/);
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
  const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
  const programme = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const v1 = { schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1, record_prefix: 'INT-FX-', writer_prefix: 'INT-FX-',
    store: { kind: 'github', repository: 'example-owner/evidence', branch: 'main', path: 'state/' }, required_checks: ['validate'] };
  const v2 = bindingV2(v1);
  assert.deepEqual(v2, { schema: 'toolkit.programme-binding.v2', repository: v1.repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-', writer_prefix: 'INT-FX-' }], store: v1.store, required_checks: ['validate'] });
  programme.validateBinding(v2);
  assert.equal(bindingV2(v2), v2, 'a v2 binding is kept as it is');
  for (const [cloud, expectWarning] of [[{ files: Object.fromEntries(workflows.WORKFLOWS.map(row => [row.file, `# copy of ${row.id}\n`])), warning: null }, false], [{ files: {}, warning: 'Toolkit: the cloud sweep copies were not refreshed in this pull request (reason). To fix it, run it.' }, true]]) {
    let published = null;
    const transport = { list: () => published ? [proposal('yes')] : [], publish(repository, binding, files) { published = { binding, files }; return proposal('yes'); }, read: () => proposal('yes') };
    const f = fixture(t, transport);
    const owner = new GovernanceProposals({ ...f.options, cloudWorkflows: () => cloud });
    prepareAdoption(f);
    fs.writeFileSync(path.join(f.cwd, governance.BINDING_FILE), JSON.stringify(v1));
    const request = owner.request(f.cwd, 'yes', run);
    const result = owner.publish(f.cwd, request.run, v1);
    assert.equal(published.binding.schema, 'toolkit.programme-binding.v2');
    assert.equal(JSON.parse(published.files['.github/toolkit-programme.json']).schema, 'toolkit.programme-binding.v2');
    assert.ok(published.files['AGENTS.md']);
    for (const row of workflows.WORKFLOWS) assert.equal(published.files[row.file], cloud.files[row.file], row.file);
    assert.equal(result.warning, expectWarning ? cloud.warning : undefined);
  }
  // No receipt reaches the renderer when the answer is no.
  let rendered = 0;
  const f = fixture(t, { list: () => [], publish: () => proposal('no'), read: () => proposal('no') });
  const owner = new GovernanceProposals({ ...f.options, cloudWorkflows: () => { rendered++; return { files: {}, warning: null }; } });
  owner.publish(f.cwd, owner.request(f.cwd, 'no', run).run);
  assert.equal(rendered, 0);
});

test('the default renderer leaves a Toolkit source checkout alone, renders both copies, and names a reason and fix when it cannot', t => {
  const { cloudWorkflowFiles } = require('../scripts/toolkit-governance-proposal.cjs');
  const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
  assert.deepEqual(cloudWorkflowFiles(path.join(__dirname, '..', '..')), { files: {}, warning: null });
  // The commit is set here, so the result never depends on whether this checkout's HEAD is on origin/main.
  const commit = workflows.toolkitHead();
  const f = fixture(t);
  const rendered = cloudWorkflowFiles(f.cwd, { commit });
  assert.equal(rendered.warning, null);
  assert.deepEqual(Object.keys(rendered.files).sort(), workflows.WORKFLOWS.map(row => row.file).sort());
  for (const text of Object.values(rendered.files)) assert.match(text, new RegExp(`^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED [a-z-]+ toolkit=${commit} `, 'm'));
  // A same-named file that is not a Toolkit copy stops the render, with the reason and the fix.
  const [sweep] = workflows.WORKFLOWS.map(row => row.file);
  fs.mkdirSync(path.join(f.cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(f.cwd, ...sweep.split('/')), 'name: my own sweep\n');
  const refused = cloudWorkflowFiles(f.cwd, { commit });
  assert.deepEqual(refused.files, {});
  assert.match(refused.warning, /cloud sweep copies were not refreshed in this pull request \(.*is not a Toolkit copy; move it aside first\)\. To fix it, run node repo\/scripts\/toolkit-cloud-workflows\.cjs --repo/);
  // A folder that is not a git checkout stops it too.
  assert.match(cloudWorkflowFiles(path.join(f.root, 'empty'), { commit }).warning || '', /not refreshed/);
});

test('no removes the marked cloud sweep copies in the same pull request, and only those', () => {
  const repository = 'example-owner/example-repo';
  const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
  const [sweep, gate] = workflows.WORKFLOWS.map(row => row.file);
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
  const [sweep, gate] = require('../scripts/toolkit-cloud-workflows.cjs').WORKFLOWS.map(row => row.file);
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
    for (const name of [sweep, gate, shards, other, ...require('../scripts/toolkit-cloud-workflows.cjs').SHARD_WORKFLOWS.map(row => row.file)]) if (endpoint.includes(`/contents/${name}?ref=${'9'.repeat(40)}`)) {
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
  const [sweep, gate] = require('../scripts/toolkit-cloud-workflows.cjs').WORKFLOWS.map(row => row.file);
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
