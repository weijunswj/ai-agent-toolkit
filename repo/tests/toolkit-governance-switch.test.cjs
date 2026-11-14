'use strict';

// The repository's one task auto-merge switch (`task_prs.auto_merge` in the merged binding):
// `refresh governance` and `setup governance` show it and offer a change only as one binding pull
// request; the old per-app answers are removed only once the new switch is merged and read back.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordMerged, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const { GitHubProposalTransport, MARKER, switchNote } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));

const SLUG = 'toolkit-test-fixture/switch';
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8')).version;
const VERSION_LINE = `Merge only after every computer and cloud copy working on this repository runs Toolkit ${VERSION} or later; older copies show governance ERROR until they update.`;

function bindingText(extra = {}) {
  return `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'], ...extra,
  }, null, 2)}\n`;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-switch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'switch'), 'switch', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const ctx = { root, home, repo, registryPath, registryOptions: { registryPath, testOnly: true } };
  ctx.merge = (text, ageMs = 0) => {
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text);
    recordMerged(repo, { registryPath, text, now: new Date(Date.now() - ageMs) });
    ctx.mergedText = text;
  };
  ctx.merge(bindingText());
  return ctx;
}

function legacyAnswers(ctx) {
  const folder = path.dirname(ctx.registryPath);
  for (const host of ['codex', 'claude-code']) fs.writeFileSync(path.join(folder, `task-auto-merge.${host}.v1.json`), `${JSON.stringify({ schema: 'toolkit.task-auto-merge-preferences.v1', host, value: 'after-gates' })}\n`);
  return () => governance.LEGACY_TASK_ANSWERS.filter(name => fs.existsSync(path.join(folder, name)));
}

async function run(ctx, argv, { interactive = false, answers = [], switchTransport = null, proposalTransport = null } = {}) {
  let out = ''; let err = '';
  const asked = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions,
    ask: async question => { asked.push(question); return answers.shift() ?? ''; },
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsPrinter: () => '== Repo block for Claude Code ==\nPaste into: fixture',
    ...(switchTransport ? { switchTransport } : {}),
    ...(proposalTransport ? { proposalTransport, cloudWorkflows: () => ({ files: {}, warning: null }) } : {}),
  });
  const code = await cli.main(argv);
  return { code, out, err, asked };
}

test('refresh governance shows the merged answers, and keeps the old per-app answers while no switch is set', async t => {
  const ctx = fixture(t);
  const present = legacyAnswers(ctx);
  const before = fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8');
  const result = await run(ctx, ['refresh']);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Governance: enabled/);
  assert.match(result.out, /Task auto-merge is off here until you set it; say refresh governance\./);
  assert.match(result.out, /Evidence store: toolkit-test-fixture\/store/);
  assert.match(result.out, /Required checks: validate/);
  assert.match(result.out, /Repo block for Claude Code/, 'the permission block is printed again');
  assert.match(result.out, /Agents: in your reply, show the owner the permission block above in full .*not a summary of it\. Offer two ways to add it: the owner pastes that command .*or you add the block for them if they ask\. Write it only on the owner's own ask/, 'the agent is told to repeat the block, since command output can be folded away');
  assert.match(result.out, /say refresh governance with on or off.*applies only after you merge it/);
  assert.equal(present().length, 2, 'no switch read back yet, so the old answers stay');
  assert.equal(fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8'), before, 'refresh never writes the binding');
  const json = JSON.parse((await run(ctx, ['refresh', '--json'])).out);
  assert.equal(json.task_auto_merge, 'unset');
  assert.deepEqual(json.removed_legacy_answers, []);
});

test('once the merged switch is read back, refresh and status remove the old per-app answers, never before', async t => {
  const ctx = fixture(t);
  let present = legacyAnswers(ctx);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }), 25 * 60 * 60 * 1000);
  const stale = await run(ctx, ['refresh']);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /run .*status.* online first/);
  assert.equal(present().length, 2, 'a stale read is not a read-back');
  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }));
  const result = await run(ctx, ['refresh']);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Task auto-merge: on \(finished task pull requests merge once their gates pass\)\./);
  assert.match(result.out, /Removed the old per-app task auto-merge answers on this computer/);
  assert.equal(present().length, 0);
  present = legacyAnswers(ctx);
  ctx.merge(bindingText({ task_prs: { auto_merge: 'off' } }));
  const status = await run(ctx, ['status']);
  assert.match(status.out, /Task auto-merge: off \(every pull request waits for a typed merge\)\./);
  assert.match(status.out, /Removed the old per-app task auto-merge answers/);
  assert.equal(present().length, 0, 'status is a governance read too');
});

test('refresh governance --set prepares one binding pull request that changes only the switch', async t => {
  const ctx = fixture(t);
  const calls = [];
  const switchTransport = { publishSwitch: (...args) => { calls.push(args); return { number: 12, url: `https://github.com/${SLUG}/pull/12`, head: 'a'.repeat(40) }; } };
  const result = await run(ctx, ['refresh', '--set', 'on'], { switchTransport });
  assert.equal(result.code, 0, result.err);
  assert.equal(calls.length, 1);
  const [repository, mergedText, text, value] = calls[0];
  assert.equal(repository, SLUG);
  assert.equal(mergedText, ctx.mergedText);
  assert.equal(value, 'after-gates');
  const proposal = JSON.parse(text);
  assert.deepEqual(proposal.task_prs, { auto_merge: 'after-gates' });
  delete proposal.task_prs;
  assert.deepEqual(proposal, JSON.parse(ctx.mergedText), 'nothing else changes, and no reader-only field leaks in');
  assert.equal(text, ctx.mergedText.replace(/\n\}\n$/, ',\n  "task_prs": { "auto_merge": "after-gates" }\n}\n'), 'the diff is the one added member');
  assert.ok(result.out.includes(VERSION_LINE), 'the older-copies warning is shown with this release');
  assert.match(result.out, /Prepared https:\/\/github\.com\/toolkit-test-fixture\/switch\/pull\/12: it sets task auto-merge on and changes nothing else\. It applies only after you merge it/);
  assert.equal(governance.taskAutoMerge(ctx.repo, ctx.registryOptions).auto_merge, 'off', 'preparing grants nothing');

  ctx.merge(bindingText({ task_prs: { auto_merge: 'after-gates' } }));
  const same = await run(ctx, ['refresh', '--set', 'after-gates'], { switchTransport });
  assert.equal(same.code, 0);
  assert.match(same.out, /already on in the merged binding\. Nothing was prepared\./);
  assert.equal(calls.length, 1);

  const offline = await run(ctx, ['refresh', '--set', 'off']);
  assert.equal(offline.code, 2);
  assert.match(offline.err, /no pull request was prepared\. Nothing was written\./);
  const moved = await run(ctx, ['refresh', '--set', 'off'], { switchTransport: { publishSwitch: () => { throw Object.assign(new Error('x'), { code: 'SWITCH_BASE_CHANGED' }); } } });
  assert.equal(moved.code, 2);
  assert.match(moved.err, /changed since this computer read it/);
  for (const bad of [['refresh', '--set', 'maybe'], ['refresh', '--set'], ['status', '--set', 'on']]) assert.equal((await run(ctx, bad)).code, 2, bad.join(' '));
});

test('the switch pull request keeps the merged formatting: a compact binding gains one member, a set value is replaced in place', async t => {
  const ctx = fixture(t);
  const texts = [];
  const switchTransport = { publishSwitch: (repository, mergedText, text) => { texts.push(text); return { number: 3, url: `https://github.com/${SLUG}/pull/3`, head: 'a'.repeat(40) }; } };
  const compact = JSON.stringify(JSON.parse(bindingText()));
  ctx.merge(compact);
  assert.equal((await run(ctx, ['refresh', '--set', 'on'], { switchTransport })).code, 0);
  assert.equal(texts.at(-1), `${compact.slice(0, -1)},"task_prs":{"auto_merge":"after-gates"}}`);
  const set = bindingText({ task_prs: { auto_merge: 'after-gates' } });
  ctx.merge(set);
  assert.equal((await run(ctx, ['refresh', '--set', 'off'], { switchTransport })).code, 0);
  assert.equal(texts.at(-1), set.replace('"auto_merge": "after-gates"', '"auto_merge": "off"'));
  const crlf = bindingText().replace(/\n/g, '\r\n');
  ctx.merge(crlf);
  assert.equal((await run(ctx, ['refresh', '--set', 'on'], { switchTransport })).code, 0);
  assert.equal(texts.at(-1), crlf.replace(/\r\n\}\r\n$/, ',\r\n  "task_prs": { "auto_merge": "after-gates" }\r\n}\r\n'));
});

test('setup governance with yes carries the switch in the same enable proposal, for a version 1 or 2 working binding', async t => {
  for (const version of [1, 2]) {
    const ctx = fixture(t);
    const binding = JSON.parse(bindingText());
    const working = version === 2 ? binding : { schema: 'toolkit.programme-binding.v1', repository: SLUG, parent_issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX', store: binding.store, required_checks: binding.required_checks };
    fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), `${JSON.stringify(working, null, 2)}\n`);
    recordAbsent(ctx.repo, { registryPath: ctx.registryPath });
    const published = [];
    let open = [];
    const proposal = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };
    const proposalTransport = { list: () => open, publish: (repository, prepared, files) => { published.push({ prepared, files }); open = [proposal]; return proposal; }, read: () => proposal };
    const result = await run(ctx, ['setup'], { interactive: true, answers: ['on', 'yes'], proposalTransport });
    assert.equal(result.code, 0, result.err);
    assert.equal(result.asked.length, 2);
    assert.equal(published.length, 1, `version ${version}`);
    const text = published[0].files['.github/toolkit-programme.json'];
    assert.equal(JSON.parse(text).task_prs.auto_merge, 'after-gates', `version ${version}`);
    assert.equal(JSON.parse(text).schema, 'toolkit.programme-binding.v2');
    assert.ok(result.out.includes(VERSION_LINE), 'the older-copies warning is shown with the proposal');
    assert.equal(governance.taskAutoMerge(ctx.repo, ctx.registryOptions).answered, false, 'a pending proposal grants nothing');
  }
  assert.equal(switchNote({ governance: 'enabled' }), '', 'an enable proposal without the switch says nothing about it');
  const note = switchNote({ governance: 'enabled', task_prs: { auto_merge: 'after-gates' } });
  assert.match(note, /sets this repository's task auto-merge switch \(`task_prs\.auto_merge`\) to `after-gates`/);
  assert.ok(note.includes(VERSION_LINE), 'the enable pull request warns about older copies');
});

test('setup governance: refresh in a governed repository; elsewhere the owner answers in a terminal, the switch with yes', async t => {
  const ctx = fixture(t);
  const governed = await run(ctx, ['setup']);
  assert.equal(governed.code, 0, governed.err);
  assert.match(governed.out, /Governance: enabled/);
  assert.match(governed.out, /off here until you set it/);

  recordMerged(ctx.repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }) });
  const refresh = await run(ctx, ['refresh']);
  assert.equal(refresh.code, 1);
  assert.match(refresh.out, /has no task auto-merge switch yet\. Say setup governance/);
  const chat = await run(ctx, ['setup']);
  assert.equal(chat.code, 2);
  assert.match(chat.err, /asks two questions in your own terminal: run .*setup.* there\. An agent cannot answer for you\./);
  const unanswered = await run(ctx, ['setup'], { interactive: true, answers: ['maybe'] });
  assert.equal(unanswered.code, 1);
  assert.match(unanswered.asked[0], /Task auto-merge for this repository.*Type on or off/);
  assert.match(unanswered.out, /Not answered\. Nothing was written\./);
});

// A gh stand-in for the transport: answers each `gh api` call from `routes` and records writes.
function fakeGh(routes) {
  const calls = [];
  const runner = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'auth') return '';
    const endpoint = args[1];
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : (input === undefined ? 'GET' : 'POST');
    for (const [pattern, reply] of routes) if (pattern.test(`${method} ${endpoint}`)) return JSON.stringify(typeof reply === 'function' ? reply(input) : reply);
    throw Object.assign(new Error('PROPOSAL_NOT_FOUND'), { code: 'PROPOSAL_NOT_FOUND' });
  };
  return { calls, runner };
}

test('the switch transport refuses a moved default branch and opens a pull request that is not a governance proposal', () => {
  const merged = bindingText();
  const proposal = bindingText({ task_prs: { auto_merge: 'after-gates' } });
  const base = 'b'.repeat(40);
  const routes = (current) => [
    [/^GET user$/, { login: 'owner' }],
    [/^GET repos\/toolkit-test-fixture\/switch$/, { default_branch: 'main' }],
    [/^GET repos\/toolkit-test-fixture\/switch\/git\/ref\/heads\/main$/, { object: { sha: base } }],
    [/^GET repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json\?ref=/, { type: 'file', encoding: 'base64', content: Buffer.from(current).toString('base64'), sha: 'c'.repeat(40) }],
    [/^GET repos\/toolkit-test-fixture\/switch\/pulls\?state=open&head=/, []],
    [/^POST repos\/toolkit-test-fixture\/switch\/git\/refs$/, { ref: 'x' }],
    [/^PUT repos\/toolkit-test-fixture\/switch\/contents\/\.github\/toolkit-programme\.json$/, { commit: { sha: 'd'.repeat(40) } }],
    [/^POST repos\/toolkit-test-fixture\/switch\/pulls$/, input => ({ number: 7, html_url: `https://github.com/${SLUG}/pull/7`, body: input.body })],
  ];
  const moved = fakeGh(routes(bindingText({ required_checks: ['validate', 'other'] })));
  assert.throws(() => new GitHubProposalTransport({ run: moved.runner }).publishSwitch(SLUG, merged, proposal, 'after-gates'), { code: 'SWITCH_BASE_CHANGED' });
  assert.ok(!moved.calls.some(call => /git\/refs$|pulls$/.test(call.args[1] || '') && call.input !== undefined), 'nothing written');

  const gh = fakeGh(routes(merged));
  const result = new GitHubProposalTransport({ run: gh.runner }).publishSwitch(SLUG, merged, proposal, 'after-gates');
  assert.equal(result.number, 7);
  const put = gh.calls.find(call => call.args.includes('PUT'));
  assert.equal(Buffer.from(put.input.content, 'base64').toString('utf8'), proposal);
  assert.match(put.input.branch, /^toolkit\/task-auto-merge-on-[0-9a-f]{32}$/);
  const pr = gh.calls.find(call => /pulls$/.test(call.args[1]) && call.input);
  assert.equal(pr.input.base, 'main');
  assert.ok(!pr.input.body.includes(MARKER), 'never read as a governance decision');
  assert.match(pr.input.body, /changes only `task_prs\.auto_merge`.*It applies only after the owner merges it/s);
  assert.ok(pr.input.body.includes(VERSION_LINE), 'the switch pull request warns about older copies');
});
