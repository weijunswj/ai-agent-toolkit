'use strict';

// The parallel CI shards offer: the question in the governance bank of a governed repository, the
// owner's answer as one binding pull request (with a first shard list for yes), the wait for pinned
// Toolkit copies that read ci_shards, and the installer copying the shard workflows only after a
// merged yes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const ROOT = path.resolve(__dirname, '..', '..');
const offer = require(path.join(scripts, 'toolkit-ci-shards-offer.cjs'));
const workflows = require(path.join(scripts, 'toolkit-cloud-workflows.cjs'));
const conformance = require(path.join(scripts, 'toolkit-governance-conformance.cjs'));
const governed = require(path.join(scripts, 'governed-test-shards.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const { GitHubProposalTransport } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));
const { BankTickets, bankReference, renderGovernanceBank, governanceBankSpecs: bankSpecs } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));

const SESSION = 'session-owner-shards';
const SLUG = 'toolkit-test-fixture/shards';
const COMMIT = workflows.toolkitHead(ROOT);
const OLD = spawnSync('git', ['rev-parse', `${offer.CI_SHARDS_READER}^`], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const PASS = "const test = require('node:test');\ntest('ok', () => {});\n";

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

function nodeRepo(t, count = 5) {
  const dir = tempDir(t, 'ci-shards-');
  spawnSync('git', ['init', '--quiet'], { cwd: dir });
  for (let index = 1; index <= count; index += 1) put(dir, `test/case${index}.test.js`, PASS);
  return dir;
}

test('offer: the estimate reads the default branch\'s last green runs', () => {
  // The estimate reads the default branch's green push runs, skips Toolkit copies and other branches,
  // takes the newest run of each workflow and keeps the largest, so a small lint job does not stand in.
  const calls = [];
  const jobs = minutes => ({ jobs: [{ startedAt: '2026-11-01T10:00:00Z', completedAt: new Date(Date.parse('2026-11-01T10:00:00Z') + minutes * 60000).toISOString() }] });
  const run = (program, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify({ default_branch: 'trunk' }) };
    if (args[1] === 'list') return { status: 0, stdout: JSON.stringify([
      { databaseId: 6, workflowName: 'Build', headBranch: 'feature' },
      { databaseId: 7, workflowName: 'Toolkit Programme Sweep', headBranch: 'trunk' },
      { databaseId: 9, workflowName: 'Lint', headBranch: 'trunk' },
      { databaseId: 8, workflowName: 'Build', headBranch: 'trunk' },
      { databaseId: 5, workflowName: 'Build', headBranch: 'trunk' },
    ]) };
    return { status: 0, stdout: JSON.stringify(args[2] === '9' ? jobs(1) : args[2] === '8' ? jobs(18) : jobs(99)) };
  };
  assert.deepEqual(offer.readEstimate('/repo', { run }), { minutes: 18, workflow: 'Build', run: 8 });
  assert.ok(calls.some(call => call.startsWith('run list --branch trunk ')), 'the run list is limited to the default branch');
  assert.deepEqual(calls.filter(call => call.startsWith('run view')).map(call => call.split(' ')[2]), ['9', '8'], 'only the newest default-branch run of each workflow is read');
  assert.deepEqual(offer.readEstimate('/repo', { run: () => ({ status: 1, stdout: '' }) }), { minutes: null, unread: 'the CI runs could not be read' }, 'an unreadable run is unknown, never a guess, and says it was not read');
});

test('offer: the first list is one rest shard plus one named shard per 10 measured minutes, two shards without timings', t => {
  const repo = nodeRepo(t, 9);
  const plain = offer.firstList(repo, null);
  assert.equal(plain.ok, true, plain.reason);
  assert.equal(plain.shards, 2);
  assert.deepEqual(plain.manifest.systems.linux.command, ['node', '--test', '{files}']);
  assert.equal(plain.manifest.systems.linux.discover, '**/*.test.js');
  assert.deepEqual(governed.manifestErrors(plain.manifest, governed.discoverAll(repo, plain.manifest)), [], 'the list is usable as written');
  assert.equal(offer.firstList(repo, { minutes: 35 }).shards, 4, '35 minutes: three named shards and the rest');
  assert.equal(offer.firstList(repo, { minutes: 4 }).shards, 2, 'under 10 minutes still splits once');
  assert.equal(offer.firstList(nodeRepo(t, 3), { minutes: 200 }).shards, 3, 'never more named shards than leave the rest shard a file');
  // Not Node tests: no list, and the reason says so.
  const python = tempDir(t, 'ci-shards-py-');
  put(python, 'tests/test_a.py', 'def test_a(): pass\n');
  assert.match(offer.firstList(python).reason, /no Node test files were found/);
  const jest = tempDir(t, 'ci-shards-jest-');
  put(jest, 'src/a.test.js', "test('a', () => {});\n");
  put(jest, 'src/b.test.js', "test('b', () => {});\n");
  assert.match(offer.firstList(jest).reason, /do not all use node:test/);
  put(jest, 'package.json', JSON.stringify({ scripts: { test: 'node --test src/' } }));
  assert.equal(offer.firstList(jest).ok, true, 'package.json running node --test counts');
});

test('offer: the binding diff adds or replaces only ci_shards', () => {
  const merged = `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled' }, null, 2)}\n`;
  const value = { answer: 'yes', offered_at: '2026-11-15T01:02:03Z' };
  const added = offer.ciShardsText(merged, JSON.parse(merged), value);
  assert.equal(added, merged.replace(/\n\}\n$/, ',\n  "ci_shards": { "answer": "yes", "offered_at": "2026-11-15T01:02:03Z" }\n}\n'));
  const replaced = offer.ciShardsText(added, JSON.parse(added), { answer: 'never', offered_at: '2026-11-16T00:00:00Z' });
  assert.equal(replaced, added.replace('"answer": "yes", "offered_at": "2026-11-15T01:02:03Z"', '"answer": "never", "offered_at": "2026-11-16T00:00:00Z"'));
});

test('offer: the answer waits while a pinned sweep copy runs a Toolkit older than the ci_shards reader', t => {
  const repo = nodeRepo(t);
  assert.deepEqual(offer.readersReady(repo, ROOT), { ok: true }, 'no pinned copy, nothing to wait for');
  const marker = commit => `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${commit} sha256=${'0'.repeat(12)}\nname: x\n`;
  put(repo, '.github/workflows/toolkit-programme-sweep.yml', marker(COMMIT));
  assert.deepEqual(offer.readersReady(repo, ROOT), { ok: true });
  put(repo, '.github/workflows/toolkit-programme-sweep.yml', marker(OLD));
  const held = offer.readersReady(repo, ROOT);
  assert.equal(held.ok, false);
  assert.match(held.reason, /toolkit-programme-sweep\.yml run a Toolkit older than the one that reads ci_shards \(3\.113\.0\).*Refresh the repository rules first/);
  assert.doesNotMatch(held.reason, /could not be checked/);
  put(repo, '.github/workflows/toolkit-programme-sweep.yml', marker('e'.repeat(40)));
  const unchecked = offer.readersReady(repo, ROOT);
  assert.equal(unchecked.ok, false, 'a commit this checkout cannot check holds too');
  // It is named as not checked, never as too old, with the step that settles it.
  assert.match(unchecked.reason, /^the pinned Toolkit copies \.github\/workflows\/toolkit-programme-sweep\.yml could not be checked, because this Toolkit copy cannot read the commit they are pinned to .+\. Run this from a Toolkit git checkout that has their commit, or refresh the repository rules first \(merge their pull request\), then answer again$/);
  assert.doesNotMatch(unchecked.reason, /older than the one that reads ci_shards/);
  assert.deepEqual(offer.oldSweepCopies(repo, ROOT, () => true), { tooOld: [], unchecked: ['.github/workflows/toolkit-programme-sweep.yml'] });
});

// ---- the bank ----------------------------------------------------------------------------------

function bindingText(extra = {}) {
  return `${JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }],
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'], ...extra,
  }, null, 2)}\n`;
}

function governedFixture(t, extra = {}) {
  const root = tempDir(t, 'ci-shards-governed-');
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'shards'), 'shards', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const ctx = { repo, registryPath, registryOptions: { registryPath, testOnly: true } };
  ctx.merge = text => { fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), text); recordMerged(repo, { registryPath, text }); ctx.mergedText = text; };
  ctx.merge(bindingText(extra));
  for (let index = 1; index <= 4; index += 1) put(repo, `test/case${index}.test.js`, PASS);
  return ctx;
}

async function run(ctx, argv, { transport = null, readers = () => ({ ok: true }), estimate = () => ({ minutes: 25, workflow: 'CI' }) } = {}) {
  let out = ''; let err = '';
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive: false, registryOptions: ctx.registryOptions, ask: async () => '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0, update: 'x', remove: 'y' }),
    environment: { TOOLKIT_HOST_SESSION: SESSION }, ciEstimator: estimate, ciReaders: readers,
    ...(transport ? { switchTransport: transport } : {}),
  });
  return { code: await cli.main(argv), out, err };
}

async function answer(ctx, reply, options = {}) {
  new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).start(SESSION, 'startup', governance.governanceState(ctx.repo, ctx.registryOptions).repository_id);
  const shown = await run(ctx, ['setup'], options);
  assert.equal(shown.code, 0, shown.err);
  const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
  const ticket = new BankTickets({ registryOptions: ctx.registryOptions }).issue(SESSION, new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION));
  return { shown, ...(await run(ctx, ['setup', '--answers', `${reference}: ${reply}`, '--ticket', ticket], options)) };
}

// `open` is what openCiShards reads: the shards answers already waiting in their pull requests.
function recorder(open = []) {
  const calls = [];
  return { calls, openCiShards: () => open, publishCiShards: (...args) => { calls.push(args); return { number: 5, url: `https://github.com/${SLUG}/pull/5`, head: 'a'.repeat(40) }; } };
}

test('bank: a governed repository with slow CI gets shards by default; the answer prepares one binding pull request with a first list', async t => {
  const ctx = governedFixture(t);
  const transport = recorder();
  const result = await answer(ctx, 'all recommended', { transport });
  assert.match(result.shown.out, /^\| \d\.\d \| Parallel CI shards \| Not ready: Yes \(Toolkit default\) \(CI about 25 min\) \| Next step: your answer prepares the shard pull request; merge it \| shards=not-now or shards=never in your reply \|$/m, '25 minutes is slow CI; the minutes sit beside the default');
  assert.doesNotMatch(result.shown.out, /^\| \d\.\d \| Parallel CI shards \| [^|]*\| [A-C]\. /m, 'never a question: the row has no choice letters');
  assert.equal(result.code, 0, result.err);
  assert.equal(transport.calls.length, 1);
  const [repository, mergedText, text, value, list] = transport.calls[0];
  assert.equal(repository, SLUG);
  assert.equal(mergedText, ctx.mergedText);
  assert.equal(value, 'yes');
  const proposal = JSON.parse(text);
  assert.equal(proposal.ci_shards.answer, 'yes');
  assert.match(proposal.ci_shards.offered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  delete proposal.ci_shards;
  assert.deepEqual(proposal, JSON.parse(ctx.mergedText), 'only ci_shards changes');
  const manifest = JSON.parse(list);
  assert.equal(manifest.systems.linux.shards.length, 3, '25 measured minutes: two named shards and the rest');
  assert.match(result.out, /Prepared https:\/\/github\.com\/toolkit-test-fixture\/shards\/pull\/5: it records parallel CI shards as yes/);
  assert.match(result.out, /It adds a first \.github\/toolkit-test-shards\.json with 3 Linux shards running node --test/);
  assert.match(result.out, /Merge only after every computer and cloud copy working on this repository runs Toolkit \d+\.\d+\.\d+ or later/);
});

test('bank: the minutes are display-only, so a CI run that finishes before the answer changes the bank reference only across 10 minutes', async t => {
  const specsFor = minutes => bankSpecs({ state: { state: 'ENABLED' }, task: 'off', merged: JSON.parse(bindingText()), ciShards: { measured: { minutes, workflow: 'CI' } } });
  assert.equal(bankReference(specsFor(12.2)), bankReference(specsFor(13.1)), 'two estimates on the same side give the same bank reference');
  assert.notEqual(bankReference(specsFor(9)), bankReference(specsFor(12)), 'crossing 10 minutes changes the default, so the reference changes');
  assert.match(renderGovernanceBank(specsFor(13.1)), /^\| \d\.\d \| Parallel CI shards \| Not ready: Yes \(Toolkit default\) \(CI about 13 min\) \| /m, 'the bank still shows the minutes');
  // End to end: the bank is shown at 12 minutes and answered after a run that measured 31.
  const ctx = governedFixture(t);
  const transport = recorder();
  new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).start(SESSION, 'startup', governance.governanceState(ctx.repo, ctx.registryOptions).repository_id);
  const shown = await run(ctx, ['setup'], { estimate: () => ({ minutes: 12, workflow: 'CI' }) });
  const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
  const ticket = new BankTickets({ registryOptions: ctx.registryOptions }).issue(SESSION, new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION));
  const answered = await run(ctx, ['setup', '--answers', `${reference}: all recommended`, '--ticket', ticket], { transport, estimate: () => ({ minutes: 31, workflow: 'CI' }) });
  assert.equal(answered.code, 0, answered.err);
  assert.equal(transport.calls.length, 1, 'the answer is accepted');
});

test('bank: one answer that changes a switch with the shards default prepares one binding pull request with both', async t => {
  const ctx = governedFixture(t);
  const transport = recorder();
  const switches = [];
  transport.publishSwitch = (...args) => { switches.push(args); return { number: 6, url: `https://github.com/${SLUG}/pull/6`, head: 'b'.repeat(40) }; };
  const result = await answer(ctx, '1.2=B', { transport });
  assert.equal(result.code, 0, result.err);
  assert.equal(switches.length, 0, 'no separate switch pull request');
  assert.equal(transport.calls.length, 1, 'one pull request on the binding');
  const [, mergedText, text, value, list, changes] = transport.calls[0];
  assert.equal(mergedText, ctx.mergedText);
  assert.equal(value, 'yes');
  assert.deepEqual(changes, { auto_merge: 'after-gates' });
  const proposal = JSON.parse(text);
  assert.equal(proposal.task_prs.auto_merge, 'after-gates');
  assert.equal(proposal.ci_shards.answer, 'yes');
  delete proposal.ci_shards;
  delete proposal.task_prs;
  const merged = JSON.parse(ctx.mergedText);
  delete merged.task_prs;
  assert.deepEqual(proposal, merged, 'only the switch and ci_shards change');
  assert.ok(list, 'the first list joins it');
  assert.match(result.out, /Prepared https:\/\/github\.com\/toolkit-test-fixture\/shards\/pull\/5: it sets task auto-merge on and records parallel CI shards as yes/);
  assert.doesNotMatch(result.out, /held/);
});

test('bank: shards are the default only for slow CI; fast or unknown CI defaults to not now', () => {
  const specsFor = measured => bankSpecs({ state: { state: 'ENABLED' }, task: 'off', merged: JSON.parse(bindingText()), ciShards: { measured } });
  const byDefault = measured => specsFor(measured).find(spec => spec.id === 'ci-shards').shards_default;
  assert.equal(byDefault({ minutes: 10, workflow: 'CI' }), 'yes', 'ten minutes or more is slow');
  assert.equal(byDefault({ minutes: 42, workflow: 'CI' }), 'yes');
  assert.equal(byDefault({ minutes: 9.4, workflow: 'CI' }), 'not-now');
  assert.equal(byDefault(null), 'not-now', 'an unknown time is never guessed slow');
  assert.match(renderGovernanceBank(specsFor({ minutes: 4, workflow: 'CI' })), /^\| \d\.\d \| Parallel CI shards \| Ready: Not needed \(Toolkit default\) \(CI about 4 min\) \| CI is under 10 minutes or its time is unknown, so Toolkit adds no shards and checks again at the next refresh\. To add them anyway, add shards=yes to your reply; shards=never stops the check \| shards=yes or shards=never in your reply \|$/m);
});

test('bank: not now writes nothing and checks again; shards=never records the answer and the default stops', async t => {
  const ctx = governedFixture(t);
  const transport = recorder();
  const later = await answer(ctx, 'all recommended', { transport, estimate: () => ({ minutes: 4, workflow: 'CI' }) });
  assert.equal(later.code, 0, later.err);
  assert.equal(transport.calls.length, 0);
  assert.doesNotMatch(later.out, /Parallel CI shards/, 'not now writes nothing and says nothing');
  const never = await answer(ctx, 'shards=never', { transport });
  assert.equal(never.code, 0, never.err);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0][3], 'never');
  assert.equal(transport.calls[0][4], null, 'never writes no list');
  // A merged not-now is the default again; a merged never or yes is only a status line.
  ctx.merge(bindingText({ ci_shards: { answer: 'not-now' } }));
  assert.match((await run(ctx, ['setup'])).out, /^\| \d\.\d \| Parallel CI shards \| Not ready: Yes \(Toolkit default\) \(CI about 25 min\) \|/m);
  for (const [merged, line] of [['never', /^\| \d\.\d \| Parallel CI shards \| Ready: Never ask \| Set in the programme file; Toolkit does not ask again \| - \|$/m], ['yes', /^\| \d\.\d \| Parallel CI shards \| Ready: Yes \| Set in the programme file; [^|]*refreshed once a day \(explain 1\.1\) \| - \|$/m]]) {
    ctx.merge(bindingText({ ci_shards: { answer: merged } }));
    let estimated = 0;
    const shown = await run(ctx, ['setup'], { estimate: () => { estimated += 1; return null; } });
    assert.match(shown.out, line);
    assert.equal(estimated, 0, 'nothing is read for a default that does not apply');
  }
});

test('bank: with governance off the shards default applies only to an answer that turns it on, and the answer waits for pinned copies that read ci_shards', async t => {
  const ctx = governedFixture(t);
  fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), bindingText({ governance: 'disabled' }));
  recordMerged(ctx.repo, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }) });
  const off = await run(ctx, ['setup']);
  assert.match(off.out, /^\| \d\.\d \| Parallel CI shards \| Yes \(Toolkit default\) \(CI about 25 min\) \| If your answer turns governance on, its pull request also adds a first shard list and the shard workflows, because /m);
  const refused = await answer(ctx, 'shards=yes', { transport: recorder() });
  assert.match(refused.out, /Parallel CI shards can be answered only while governance is on/);
  const held = governedFixture(t);
  const transport = recorder();
  const result = await answer(held, 'all recommended', { transport, readers: () => ({ ok: false, reason: 'the pinned Toolkit copies x run a Toolkit older than the one that reads ci_shards (3.113.0), and would read the binding as invalid. Refresh the repository rules first (merge their pull request), then answer again' }) });
  assert.equal(result.code, 2);
  assert.match(result.err, /answer was not prepared: .*Refresh the repository rules first.*Nothing was written\./);
  assert.equal(transport.calls.length, 0);
  // A repository whose tests are not Node tests (a Python suite) is not applicable, with why, and no
  // answer records shards for it, however slow its CI.
  const python = governedFixture(t);
  for (let index = 1; index <= 4; index += 1) fs.rmSync(path.join(python.repo, `test/case${index}.test.js`));
  put(python.repo, 'tests/test_a.py', 'def test_a(): pass\n');
  const pyTransport = recorder();
  assert.match((await run(python, ['setup'])).out, /^\| \d\.\d \| Parallel CI shards \| Ready: Not applicable \| Toolkit can split only Node tests, and no Node test files were found /m);
  const yes = await answer(python, 'all recommended', { transport: pyTransport });
  assert.equal(yes.code, 0, yes.err);
  assert.equal(pyTransport.calls.length, 0, 'nothing is prepared for shards');
});

test('transport: the answer pull request starts from the exact merged binding and adds the list only when none is there', () => {
  const merged = bindingText();
  const proposal = offer.ciShardsText(merged, JSON.parse(merged), { answer: 'yes', offered_at: '2026-11-15T00:00:00Z' });
  const fake = ({ base = merged, list = false, open = [] } = {}) => {
    const calls = [];
    const runner = args => {
      calls.push(args);
      const endpoint = args[1];
      if (args[0] === 'auth') return '';
      if (endpoint === 'user') return JSON.stringify({ login: 'toolkit-test-fixture' });
      if (endpoint === `repos/${SLUG}`) return JSON.stringify({ default_branch: 'main' });
      if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'b'.repeat(40) } });
      if (endpoint.includes('/contents/.github/toolkit-programme.json?ref=')) return JSON.stringify({ type: 'file', encoding: 'base64', sha: 'c'.repeat(40), content: Buffer.from(base).toString('base64') });
      if (endpoint.includes('/contents/.github/toolkit-test-shards.json?ref=')) { if (list) return JSON.stringify({ type: 'file' }); throw Object.assign(new Error('missing'), { code: 'PROPOSAL_NOT_FOUND' }); }
      if (endpoint.includes('/pulls?state=open&per_page=100')) return JSON.stringify(open);
      if (endpoint.includes('/pulls?state=open')) return '[]';
      if (endpoint.includes('/git/ref/heads/toolkit/')) throw Object.assign(new Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
      if (endpoint.endsWith('/git/refs')) return '{}';
      if (endpoint.includes('/contents/')) return JSON.stringify({ commit: { sha: 'd'.repeat(40) } });
      if (endpoint.endsWith('/pulls')) return JSON.stringify({ number: 9, html_url: `https://github.com/${SLUG}/pull/9` });
      throw new Error(`unexpected ${endpoint}`);
    };
    return { calls, transport: new GitHubProposalTransport({ run: runner }) };
  };
  const fresh = fake();
  assert.equal(fresh.transport.publishCiShards(SLUG, merged, proposal, 'yes', '{"list":1}\n').number, 9);
  const puts = fresh.calls.filter(args => args.includes('PUT')).map(args => args[1]);
  assert.deepEqual(puts, [`repos/${SLUG}/contents/.github/toolkit-programme.json`, `repos/${SLUG}/contents/.github/toolkit-test-shards.json`]);
  const kept = fake({ list: true });
  kept.transport.publishCiShards(SLUG, merged, proposal, 'yes', '{"list":1}\n');
  assert.equal(kept.calls.filter(args => args.includes('PUT')).length, 1, 'a list already on the default branch is kept');
  assert.throws(() => fake({ base: bindingText({ required_checks: [] }) }).transport.publishCiShards(SLUG, merged, proposal, 'yes', null), { code: 'SWITCH_BASE_CHANGED' });
  // A switch change from the same answer joins it: one branch, one pull request that names both.
  const both = fake();
  both.transport.publishCiShards(SLUG, merged, proposal, 'yes', null, { auto_merge: 'after-gates' });
  assert.ok(both.calls.some(args => JSON.stringify(args).includes('toolkit/switches-task-auto-merge-on-ci-shards-yes-')), 'the branch names both');
  assert.equal(both.calls.filter(args => args[1] === `repos/${SLUG}/pulls`).length, 1, 'one pull request');
  // Another shards answer still open is the one to merge or close: no branch and no second pull request.
  const waiting = { number: 7, url: `https://github.com/${SLUG}/pull/7`, ref: 'toolkit/ci-shards-yes-0123456789ab', repo: SLUG };
  const others = [{ number: 8, url: 'u8', ref: 'toolkit/ci-shards-yes-0123456789ab', repo: 'someone/fork' }, { number: 9, url: 'u9', ref: 'toolkit/switches-task-auto-merge-on-0123', repo: SLUG }];
  assert.deepEqual(fake({ open: [...others, waiting] }).transport.openCiShards(SLUG), [{ number: 7, url: waiting.url }], 'only this repository\'s own shards branches');
  const held = fake({ open: [waiting] });
  assert.throws(() => held.transport.publishCiShards(SLUG, merged, proposal, 'never', null), { code: 'SHARDS_PR_OPEN', url: waiting.url });
  assert.equal(held.calls.filter(args => args[1].endsWith('/git/refs') || args[1] === `repos/${SLUG}/pulls`).length, 0, 'nothing is made');
  assert.equal(fake({ open: others }).transport.publishCiShards(SLUG, merged, proposal, 'yes', null).number, 9, 'a fork or a switches-only branch holds nothing');
});

test('bank: an answer waiting in its pull request shows as that pull request, shards=not-now prepares nothing, and a second is never prepared', async t => {
  const ctx = governedFixture(t);
  const url = `https://github.com/${SLUG}/pull/7`;
  const pattern = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const waiting = recorder([{ number: 7, url }]);
  const shown = await answer(ctx, 'all recommended', { transport: waiting });
  assert.match(shown.shown.out, new RegExp(`^\\| \\d\\.\\d \\| Parallel CI shards \\| Not ready: Pull request #7 open \\| Next step: merge pull request #7 \\(${pattern(url)}\\) \\| - \\|$`, 'm'));
  assert.equal(waiting.calls.length, 0, 'all recommended prepares no second pull request');
  // Slow CI makes shards the default, but shards=not-now skips them: nothing is written for them.
  const quiet = recorder();
  const left = await answer(ctx, 'shards=not-now', { transport: quiet });
  assert.match(left.shown.out, /^\| \d\.\d \| Parallel CI shards \| Not ready: Yes \(Toolkit default\) \(CI about 25 min\) \|/m);
  assert.equal(left.code, 0, left.err);
  assert.equal(quiet.calls.length, 0);
  assert.doesNotMatch(left.out, /Parallel CI shards|toolkit-test-shards/);
  // A pull request opened between showing the bank and answering it: the answer names it and stops.
  const raced = { openCiShards: () => [], publishCiShards: () => { throw Object.assign(new Error('SHARDS_PR_OPEN'), { code: 'SHARDS_PR_OPEN', url }); } };
  const refused = await answer(ctx, 'all recommended', { transport: raced });
  assert.notEqual(refused.code, 0);
  assert.match(`${refused.out}${refused.err}`, new RegExp(`A parallel CI shards pull request is already open, so no second one was prepared: ${pattern(url)}\\. Merge it, or close it and answer again\\. Nothing was written\\.`));
});

// ---- the installer and the governance check ----------------------------------------------------

function listRepo(t, workflow) {
  const repo = nodeRepo(t, 3);
  put(repo, governed.MANIFEST_REL, JSON.stringify({ schema: governed.MANIFEST_SCHEMA, ...(workflow ? { workflow } : {}), systems: { linux: { command: ['node', '--test', '{files}'], discover: 'test/*.test.js', shards: [{ id: 'linux-1', files: ['test/case1.test.js'] }, { id: 'linux-2', rest: true }] } } }));
  return repo;
}

test('installer: the shard workflows are copied only after a merged yes, with the reason otherwise', t => {
  const repo = listRepo(t);
  const plan = answer => workflows.plan({ repo, root: ROOT, commit: COMMIT, ciShards: answer });
  for (const [value, reason] of [[null, /has no yes to parallel CI shards \(ci_shards\); say refresh governance to answer it/], ['not-now', /has no yes/], ['never', /answers never to parallel CI shards/]]) {
    const result = plan(value);
    assert.deepEqual(result.rows.filter(row => row.kind === 'rendered').map(row => row.id), ['programme-sweep', 'programme-sweep-gate'], String(value));
    assert.match(result.not_copied[0].reason, reason);
  }
  assert.deepEqual(plan('yes').rows.filter(row => row.kind === 'rendered').map(row => row.id), ['programme-sweep', 'programme-sweep-gate', 'test-shards', 'shard-timings']);
  // Without an answer given, the installer reads the merged binding on this computer (none here).
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).ci_shards, null);
});

test('governance check: copies left after never are drift; a copy at an old workflow name is drift; the gate is suggested as required', t => {
  const repo = listRepo(t, 'shards.yml');
  let merged = { ci_shards: { answer: 'yes' }, required_checks: [] };
  const findings = () => conformance.cloudWorkflowFindings({ root: repo }, ROOT, { cloudWorkflowsCommit: COMMIT, mergedBinding: () => merged });
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT, ciShards: 'yes' }));
  assert.deepEqual(findings().map(entry => `${entry.id}:${entry.severity}`), ['CI_SHARDS_GATE_NOT_REQUIRED:info']);
  assert.match(findings()[0].message, /"Toolkit test shards" is not a required check here\. Consider making it required .*Toolkit never sets it for you\./);
  merged = { ...merged, required_checks: ['Toolkit test shards'] };
  assert.deepEqual(findings(), [], 'required: nothing to suggest');
  // The list renames its workflow: the copy at the old name is reported.
  const list = JSON.parse(fs.readFileSync(path.join(repo, governed.MANIFEST_REL), 'utf8'));
  put(repo, governed.MANIFEST_REL, JSON.stringify({ ...list, workflow: 'tests-sharded.yml' }));
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT, ciShards: 'yes' }));
  assert.deepEqual(findings().map(entry => entry.message), ['.github/workflows/shards.yml is a Toolkit test shards copy at an old name; the shard list now names .github/workflows/tests-sharded.yml, so both run. Remove .github/workflows/shards.yml in a pull request.']);
  fs.rmSync(path.join(repo, '.github/workflows/shards.yml'));
  assert.deepEqual(findings(), []);
  // The owner answers never later: the copies left behind are drift, with the fix.
  merged = { ...merged, ci_shards: { answer: 'never' } };
  const left = findings().filter(entry => entry.severity === 'drift').map(entry => entry.message);
  assert.equal(left.length, 2);
  for (const message of left) assert.match(message, /no longer copied: the merged binding answers never to parallel CI shards \(ci_shards\)\. Repair the shard list and refresh the repository rules, or remove the shard copies in a pull request\./);
});

// ---- the retired schedule_folder key ------------------------------------------------------------

test('bank: the shards pull request drops the retired schedule_folder line, alone or with a switch, and its text says so', async t => {
  const withRetired = text => text.replace('  "required_checks"', '  "schedule_folder": "TOOLKIT",\n  "required_checks"');
  const stamp = text => text.replace(/"offered_at": "[^"]*"/, '"offered_at": "T"');
  for (const reply of ['all recommended', '1.2=B']) {
    const plain = governedFixture(t);
    const before = recorder();
    assert.equal((await answer(plain, reply, { transport: before })).code, 0);
    const carried = governedFixture(t);
    carried.merge(withRetired(bindingText()));
    const after = recorder();
    const result = await answer(carried, reply, { transport: after });
    assert.equal(result.code, 0, result.err);
    const [, mergedText, text] = after.calls[0];
    assert.equal(mergedText, carried.mergedText, `${reply}: the pull request starts from the exact merged text`);
    assert.match(carried.mergedText, /"schedule_folder"/);
    assert.equal(stamp(text), stamp(before.calls[0][2]), `${reply}: the only other change is the removed schedule_folder line`);
  }
  // The transport's pull request text names the deleted line only when one goes.
  const proposal = offer.ciShardsText(bindingText(), JSON.parse(bindingText()), { answer: 'never' });
  const body = merged => {
    let sent = null;
    const runner = (args, input) => {
      const endpoint = args[1];
      if (args[0] === 'auth') return '';
      if (endpoint === 'user') return JSON.stringify({ login: 'toolkit-test-fixture' });
      if (endpoint === `repos/${SLUG}`) return JSON.stringify({ default_branch: 'main' });
      if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: 'b'.repeat(40) } });
      if (endpoint.includes('/contents/.github/toolkit-programme.json?ref=')) return JSON.stringify({ type: 'file', encoding: 'base64', sha: 'c'.repeat(40), content: Buffer.from(merged).toString('base64') });
      if (endpoint.includes('/pulls?state=open')) return '[]';
      if (endpoint.includes('/git/ref/heads/toolkit/')) throw Object.assign(new Error('missing'), { code: 'PROPOSAL_NOT_FOUND' });
      if (endpoint.endsWith('/git/refs')) return '{}';
      if (endpoint.includes('/contents/')) return JSON.stringify({ commit: { sha: 'd'.repeat(40) } });
      if (endpoint.endsWith('/pulls')) { sent = input.body; return JSON.stringify({ number: 9, html_url: `https://github.com/${SLUG}/pull/9` }); }
      throw new Error(`unexpected ${endpoint}`);
    };
    new GitHubProposalTransport({ run: runner }).publishCiShards(SLUG, merged, proposal, 'never', null);
    return sent;
  };
  assert.match(body(withRetired(bindingText())), /parallel CI shards answer\. It also deletes the retired `schedule_folder`, which nothing reads any more\. Nothing else changes\./);
  assert.match(body(bindingText()), /parallel CI shards answer\. Nothing else changes\./);
});

test('existingShards names the workflow whose job matrix already splits the tests, and nothing else counts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-existing-shards-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(offer.existingShards(root), null, 'no workflow');
  fs.writeFileSync(path.join(dir, 'ci.yml'), 'jobs:\n  test:\n    strategy:\n      matrix:\n        node: [20, 22]\n    steps:\n      - run: npm test\n');
  assert.equal(offer.existingShards(root), null, 'a matrix without a shard key');
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'toolkit-test-shards.json'), '{}\n');
  assert.equal(offer.existingShards(root), null, 'a shard list alone runs nothing in parallel');
  fs.writeFileSync(path.join(dir, 'validate.yml'), 'jobs:\n  tests:\n    strategy:\n      matrix:\n        shard-index: [1, 2]\n    steps:\n      - run: npx playwright test --shard=${{ matrix.shard-index }}/2\n');
  assert.equal(offer.existingShards(root), '.github/workflows/validate.yml');
  assert.equal(offer.existingShards(ROOT), '.github/workflows/validate.yml', 'this repository\'s own CI shards');
});

// ---- a split the owner closed without merging (INT-TK421-1360) ---------------------------------

// `closed` is what closedCiShards reads: the newest shard split closed without merging, or null.
function closedRecorder(closed) {
  const transport = recorder();
  transport.closedCiShards = () => closed;
  return transport;
}

test('bank: a split closed without merging is asked about once, no plain reply reopens it, and the answer is remembered', async t => {
  const ctx = governedFixture(t);
  const url = `https://github.com/${SLUG}/pull/11`;
  const asked = closedRecorder({ number: 11, url });
  const first = await answer(ctx, 'all recommended', { transport: asked });
  // This fixture reads no GitHub, so the App is unknown: one part could not be checked.
  assert.match(first.shown.out, /^# Toolkit governance choices - ON, not ready, 1 step left; 1 part could not be checked$/m);
  assert.match(first.shown.out, new RegExp(`^\| \d\.\d \| Parallel CI shards \| Not ready: Pull request #11 closed without merging \| Next step: answer once: shards=yes opens a new pull request, shards=never stops the offer, anything else keeps them off \| shards=yes or shards=never in your reply \|$`, 'm'));
  assert.equal(first.code, 0, first.err);
  assert.equal(asked.calls.length, 0, 'slow CI alone does not reopen a split the owner closed');
  // The next bank says it was answered and asks nothing; a plain reply still opens nothing.
  const again = closedRecorder({ number: 11, url });
  const second = await answer(ctx, 'all recommended', { transport: again });
  assert.match(second.shown.out, /^\| \d\.\d \| Parallel CI shards \| Ready: Off: pull request #11 was closed \| /m);
  assert.match(second.shown.out, /^# Toolkit governance choices - ON, ready; 1 part could not be checked$/m);
  assert.equal(again.calls.length, 0);
  // shards=yes still opens a new one when the owner asks for it.
  const yes = closedRecorder({ number: 11, url });
  assert.equal((await answer(ctx, 'shards=yes', { transport: yes })).code, 0);
  assert.equal(yes.calls.length, 1);
  assert.equal(yes.calls[0][3], 'yes');
  // A later split closed again is a new close: asked once more.
  const newer = closedRecorder({ number: 15, url: `https://github.com/${SLUG}/pull/15` });
  assert.match((await answer(ctx, 'shards=never', { transport: newer })).shown.out, /Not ready: Pull request #15 closed without merging/);
  assert.equal(newer.calls[0][3], 'never');
  assert.equal(offer.closedSplitAnswer(ctx.registryOptions, governance.governanceState(ctx.repo, ctx.registryOptions).repository_id, 15).answer, 'never');
});

test('bank: an answer that is not used remembers nothing, and an open split is shown before any closed one', async t => {
  const ctx = governedFixture(t);
  const url = `https://github.com/${SLUG}/pull/11`;
  // A reply the bank cannot read is not an answer: the close is asked about again.
  const unread = closedRecorder({ number: 11, url });
  assert.match((await answer(ctx, 'maybe later perhaps', { transport: unread })).out, /Nothing was written/);
  const repositoryId = governance.governanceState(ctx.repo, ctx.registryOptions).repository_id;
  assert.equal(offer.closedSplitAnswer(ctx.registryOptions, repositoryId, 11), null);
  // An open split is the one to merge or close; the closed one is not read.
  const both = recorder([{ number: 12, url: `https://github.com/${SLUG}/pull/12` }]);
  both.closedCiShards = () => assert.fail('the closed list is not read while one is open');
  assert.match((await answer(ctx, 'all recommended', { transport: both })).shown.out, /Not ready: Pull request #12 open/);
  // A closed list that cannot be read is no ask, as an unread open list is.
  const failing = recorder();
  failing.closedCiShards = () => { throw new Error('gh-unavailable'); };
  assert.match((await answer(ctx, 'shards=not-now', { transport: failing })).shown.out, /Not ready: Yes \(Toolkit default\)/);
});

test('transport: the closed split read takes only this repository\'s own unmerged shards-yes branches, newest first', () => {
  const pulls = [
    { number: 20, url: 'u20', ref: 'toolkit/ci-shards-yes-0123456789ab', repo: SLUG, merged: true },
    { number: 19, url: 'u19', ref: 'toolkit/ci-shards-never-0123456789ab', repo: SLUG, merged: false },
    { number: 18, url: 'u18', ref: 'toolkit/ci-shards-yes-0123456789ab', repo: 'someone/fork', merged: false },
    { number: 17, url: 'u17', ref: 'feature/ci-shards-yes-x', repo: SLUG, merged: false },
    { number: 13, url: 'u13', ref: 'toolkit/ci-shards-yes-aaaaaaaaaaaa', repo: SLUG, merged: false },
    { number: 16, url: 'u16', ref: 'toolkit/switches-task-auto-merge-on-ci-shards-yes-bbbbbbbbbbbb', repo: SLUG, merged: false },
  ];
  const asked = [];
  const transport = list => new GitHubProposalTransport({ run: args => {
    asked.push(args[1]);
    if (args[0] === 'auth') return '';
    if (args[1] === 'user') return JSON.stringify({ login: 'toolkit-test-fixture' });
    return JSON.stringify(list);
  } });
  assert.deepEqual(transport(pulls).closedCiShards(SLUG), { number: 16, url: 'u16' });
  assert.ok(asked.some(endpoint => endpoint === `repos/${SLUG}/pulls?state=closed&sort=updated&direction=desc&per_page=100`));
  assert.equal(transport(pulls.slice(0, 4)).closedCiShards(SLUG), null);
  assert.throws(() => transport({ message: 'nope' }).closedCiShards(SLUG), { code: 'PROPOSAL_LIST_INCOMPLETE' });
});
