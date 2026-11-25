'use strict';

// Turning governance on in a fresh repository from the governance question bank: the bank shows the
// store, parent issue and checks as status lines (or the store as a question when one is found), and
// the owner's answer makes the missing store and parent issue and publishes one turn-on pull request
// with the programme file and the CI checks only. Offline fakes stand in for GitHub.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');
const { managedAgentsCopy } = require('./support/retired-instruction-copies.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const adopt = require(path.join(scripts, 'toolkit-governance-adopt.cjs'));

const OWNER = 'toolkit-test-fixture';
const SLUG = `${OWNER}/fresh`;
const STORE = `${OWNER}/TRANSPORT-fresh`;

// A fresh repository: a github.com origin, no governed rules, no programme file, nothing merged.
function fixture(t, { agents = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-adopt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = makeGoverned(path.join(root, 'fresh'), 'fresh', { home });
  fs.rmSync(path.join(repo, 'AGENTS.md'));
  fs.rmSync(path.join(repo, '.github', 'toolkit-programme.json'));
  if (agents !== null) fs.writeFileSync(path.join(repo, 'AGENTS.md'), agents);
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  recordAbsent(repo, { registryPath });
  return { repo, registryOptions: { registryPath, testOnly: true } };
}

// GitHub as discovery reads it and the adoption writer changes it.
function fakeGitHub({ repos = {}, issues = [], failIssue = false } = {}) {
  const calls = [];
  const world = { repos: { ...repos }, issues: [...issues], nextIssue: 7 };
  const get = (endpoint) => {
    const url = endpoint.split('?')[0];
    if (url === `repos/${SLUG}/issues`) return { ok: true, value: world.issues };
    if (url === 'user/repos') return { ok: true, value: Object.keys(world.repos).map(full => ({ name: full.split('/')[1], owner: { login: OWNER } })) };
    if (url === `repos/${SLUG}`) return { ok: true, value: { default_branch: 'main' } };
    if (url === `repos/${SLUG}/rules/branches/main`) return { ok: true, value: [] };
    if (url === `repos/${SLUG}/branches/main/protection/required_status_checks`) return { ok: false, reason: 'not-found' };
    if (url === `repos/${SLUG}/rulesets`) return { ok: true, value: [] };
    const store = /^repos\/([^/]+\/[^/]+?)(\/contents\/.*)?$/.exec(url);
    if (store && world.repos[store[1]]) {
      const entry = world.repos[store[1]];
      if (!store[2]) return { ok: true, value: { private: entry.private, owner: { login: OWNER } } };
      if (store[2] === '/contents/') return { ok: true, value: entry.dirs.map(name => ({ type: 'dir', name })) };
      return { ok: false, reason: 'not-found' };
    }
    return { ok: false, reason: 'not-found' };
  };
  const writer = {
    get: endpoint => get(endpoint),
    createPrivateRepository(owner, name) { calls.push(['create', `${owner}/${name}`]); world.repos[`${owner}/${name}`] = { private: true, dirs: [] }; return { ok: true, value: {} }; },
    putFile(repository, file) { calls.push(['put', repository, file]); world.repos[repository].dirs.push(file.split('/')[0]); return { ok: true, value: {} }; },
    createIssue(repository, title) {
      calls.push(['issue', repository, title]);
      if (failIssue) return { ok: false, reason: 'gh-request-failed' };
      const number = world.nextIssue++;
      world.issues.push({ number, title, state: 'open', labels: [] });
      return { ok: true, value: { number } };
    },
  };
  return { calls, world, discoveryGh: args => get(args[0]), writer };
}

// What the real installer leaves in the working tree: every turn-on pull request must carry these.
function writePlainText(root) {
  for (const name of ['.github/plain-text.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), `${name}\n`);
  }
}

const PROPOSAL = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };

// `opened` is what GitHub lists as open governance pull requests when the run starts.
async function run(ctx, argv, github, { answers = [], interactive = false, plainTextFails = false, estimate = null, opened = [] } = {}) {
  let out = ''; let err = '';
  const published = [];
  let open = opened;
  const proposal = PROPOSAL;
  const plainText = [];
  const cloud = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions,
    ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), environment: { TOOLKIT_HOST_SESSION: 'session-adopt' },
    discoveryGh: github.discoveryGh, adoptionWriter: github.writer, plainTextInstaller: root => { if (plainTextFails) throw Object.assign(new Error('The plain-text check could not be installed.'), { code: 'FIXTURE' }); plainText.push(root); writePlainText(root); },
    proposalTransport: { list: () => open, publish: (repository, binding, files) => { published.push({ binding, files }); open = [proposal]; return proposal; }, read: () => proposal },
    cloudWorkflows: (cwd, options) => { cloud.push(options); return { files: {}, warning: null }; },
    ...(estimate ? { ciEstimator: () => estimate } : {}),
  });
  const code = await cli.main(argv);
  return { code, out, err, published, plainText, cloud };
}

test('a fresh repository after the card\'s yes asks only task auto-merge, names its store, and all recommended makes the store and parent and one turn-on pull request', async t => {
  const ctx = fixture(t, { agents: '# My own rules\n\nKeep this exactly.\n' });
  const github = fakeGitHub();
  const shown = await run(ctx, ['setup', '--json'], github);
  const questions = JSON.parse(shown.out).questions;
  assert.deepEqual(questions.map(spec => [spec.id, Boolean(spec.report_only)]), [['task-auto-merge', false], ['governance', true], ['ci-shards', true], ['evidence-store', true], ['parent-issue', true], ['required-checks', true], ['governance-app', true], ['permission-blocks', true]]);
  assert.deepEqual(questions.filter(spec => !spec.report_only).map(spec => spec.presentation.question_ref), ['1.1'], 'one question: task auto-merge');
  const table = (await run(ctx, ['setup'], github, { interactive: true, answers: [''] })).out;
  assert.match(table, /^\| 1\.1 \| Task auto-merge \| Off \(needs governance\) \| A\. Keep current/m);
  assert.doesNotMatch(table, /^\| 1\.2 \||^\| 2\.1 \|/m, 'no second question');
  assert.match(table, /^- GitHub governance: Not decided\. Your answer turns it on: Toolkit prepares one pull request, and it applies only after you merge it\.$/m);
  // The store is named before the answer: this repository's own TRANSPORT-<name>, to be created.
  assert.match(table, /^- Evidence store: TRANSPORT-fresh\. None yet: Toolkit creates the private GitHub repository toolkit-test-fixture\/TRANSPORT-fresh when governance turns on, for programme records and evidence\./m);
  assert.match(table, /^- Parent issue: None yet\. Toolkit opens one when governance turns on\.$/m);
  assert.match(table, /^Reply all recommended to turn governance on as shown, or only your changes such as 1\.1=B\..* To keep governance off instead, reply no store: Toolkit then makes nothing and asks again next session\./m);
  assert.equal(github.calls.length, 0, 'showing the bank makes nothing');

  const before = fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8');
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(result.code, 0, result.err + result.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md'], ['issue', SLUG, 'Programme: fresh']]);
  assert.match(result.out, /Made on GitHub: private evidence store toolkit-test-fixture\/TRANSPORT-fresh, parent issue #7\./);
  // The turn-on result names the store and how it was chosen.
  assert.match(result.out, /^Store: toolkit-test-fixture\/TRANSPORT-fresh, a private GitHub repository \(created for this repository\), for programme records and evidence\.$/m);
  assert.equal(result.published.length, 1, 'one turn-on pull request');
  const { binding, files } = result.published[0];
  assert.deepEqual(binding.parents, [{ issue: 7, record_prefix: 'INT-FRE7-' }]);
  assert.deepEqual(binding.store, { kind: 'github', repository: STORE, branch: 'main', path: `state/${SLUG}/` });
  assert.deepEqual(binding.task_prs, { auto_merge: 'off', merge_train: 'off' });
  assert.deepEqual(JSON.parse(files['.github/toolkit-programme.json']), binding);
  // The installed Toolkit delivers the governed rules, so the pull request carries the programme file
  // and the CI checks only: no AGENTS.md, CLAUDE.md, Antigravity bootstrap or playbooks.
  assert.deepEqual(Object.keys(files).sort(), ['.github/dependabot.yml', '.github/plain-text.json', '.github/scripts/plain-text-check.cjs',
    '.github/toolkit-programme.json', '.github/workflows/dependency-auto-merge.yml', '.github/workflows/plain-text.yml']);
  // The dependency security files join the same pull request, so governance never starts with its own
  // security check failing.
  assert.match(files['.github/dependabot.yml'], /package-ecosystem: "?github-actions"?/);
  assert.match(files['.github/workflows/dependency-auto-merge.yml'], /^# Toolkit dependency auto-merge v/m);
  assert.match(result.out, /Added \.github\/dependabot\.yml and \.github\/workflows\/dependency-auto-merge\.yml to the working tree/);
  assert.equal(fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8'), before, 'the repository\'s own AGENTS.md is not changed');
  assert.ok(!fs.existsSync(path.join(ctx.repo, 'CLAUDE.md')));
  assert.equal(result.plainText.length, 1);
  // The App is not set up, so the result gives the owner's one command, with the store, by default.
  assert.match(result.out, new RegExp(`^node "[^"]+toolkit-governance-app-setup\\.cjs" --repo ${SLUG} --store ${STORE}$`, 'm'));
  assert.doesNotMatch(result.out, /pre-filled page|Governance GitHub App: not now/, 'no by-hand App steps and no not-now line');
  // Task auto-merge on in the same answer: the same one pull request sets it.
  const auto = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['1.1=B'] });
  assert.equal(auto.code, 0, auto.err + auto.out);
  assert.deepEqual(auto.published[0].binding.task_prs, { auto_merge: 'after-gates', merge_train: 'off' });
});

test('answering no store makes nothing: no pull request, store or parent issue, and governance stays off', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const answered = await run(ctx, ['setup'], github, { interactive: true, answers: ['no store'] });
  assert.equal(answered.code, 0, answered.err + answered.out);
  assert.match(answered.out, /^Governance needs a store, so it stays off\. Nothing was written: no pull request, store or parent issue was made\./m);
  assert.deepEqual(github.calls, []);
  assert.equal(answered.published.length, 0);
  assert.equal(require(path.join(scripts, 'toolkit-governance-state.cjs')).governanceState(ctx.repo, ctx.registryOptions).state, 'UNDECIDED');
  // No store goes on its own.
  const mixed = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['no store, 1.1=B', ''] });
  assert.match(mixed.out, /No store keeps governance off, so it goes on its own/);
  assert.equal(mixed.published.length, 0);
});

test('a failed step stops with what was made, and answering again reuses it instead of making a second one', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub({ failIssue: true });
  const failed = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(failed.code, 2);
  assert.match(failed.out, /The parent issue could not be opened \(gh-request-failed\)\. No pull request was prepared\./);
  assert.match(failed.out, /Already made, and reused when you answer again: private evidence store toolkit-test-fixture\/TRANSPORT-fresh\./);
  assert.match(failed.out, /^Once the cause is fixed, type toolkit governance and answer again\.$/m);
  assert.doesNotMatch(failed.out, /Show the bank/, 'the failure never tells an agent to show the bank');
  assert.equal(failed.published.length, 0);

  const retry = fakeGitHub({ repos: github.world.repos });
  const shown = await run(ctx, ['setup'], retry, { interactive: true, answers: [''] });
  assert.match(shown.out, /^- Evidence store: TRANSPORT-fresh\. Found: your private GitHub repository toolkit-test-fixture\/TRANSPORT-fresh, used for programme records and evidence\./m, 'the store made last time is found, not offered again');
  const done = await run(ctx, ['setup'], retry, { interactive: true, answers: ['all recommended'] });
  assert.equal(done.code, 0, done.err + done.out);
  assert.deepEqual(retry.calls, [['issue', SLUG, 'Programme: fresh']], 'no second store');
  assert.equal(done.published[0].binding.store.repository, STORE);
});

test('a render that fails stops before anything is made on GitHub', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'], plainTextFails: true });
  assert.notEqual(result.code, 0);
  assert.deepEqual(github.calls, [], 'no store or issue is made when the local render fails');
  assert.equal(result.published.length, 0);
});

test('another repository\'s store is never picked on its own: the own TRANSPORT store is created, and a named one is used only after the same checks', async t => {
  const ctx = fixture(t);
  const other = `${OWNER}/TRANSPORT-elsewhere`;
  const parent = { number: 3, title: 'Programme tracker', state: 'open', labels: [] };
  const github = fakeGitHub({ repos: { [other]: { private: true, dirs: ['archives', 'state'] }, [`${OWNER}/fresh-evidence`]: { private: true, dirs: ['archives'] } }, issues: [parent] });
  const shown = await run(ctx, ['setup'], github, { interactive: true, answers: [''] });
  assert.match(shown.out, /^- Evidence store: TRANSPORT-fresh\. None yet: Toolkit creates the private GitHub repository toolkit-test-fixture\/TRANSPORT-fresh when governance turns on/m);
  assert.doesNotMatch(shown.out, /TRANSPORT-elsewhere|fresh-evidence/, 'the other stores are not offered');
  assert.match(shown.out, /^- Parent issue: #3\. Reused when governance turns on\.$/m);
  const made = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(made.code, 0, made.err + made.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md']]);
  assert.equal(made.published[0].binding.store.repository, STORE);
  assert.equal(made.published[0].binding.parents[0].issue, 3);

  // Named: used when it reads back as a private store of the same owner, and nothing is created.
  const named = fakeGitHub({ repos: { [other]: { private: true, dirs: ['archives'] } }, issues: [parent] });
  const used = await run(fixture(t), ['setup'], named, { interactive: true, answers: [`store=${other}`] });
  assert.equal(used.code, 0, used.err + used.out);
  assert.deepEqual(named.calls, []);
  assert.equal(used.published[0].binding.store.repository, other);
  assert.match(used.out, new RegExp(`^Store: ${other}, a private GitHub repository \\(the one you named\\), for programme records and evidence\\.$`, 'm'));
  // A named repository that is public is refused before anything is made.
  const open = fakeGitHub({ repos: { [`${OWNER}/public-one`]: { private: false, dirs: ['archives'] } } });
  const refused = await run(fixture(t), ['setup'], open, { interactive: true, answers: [`store=${OWNER}/public-one`] });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /toolkit-test-fixture\/public-one was not used as the evidence store, because/);
  assert.deepEqual(open.calls, []);
  assert.equal(refused.published.length, 0);
  // A malformed name is refused as unreadable, nothing written.
  const bad = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['store=not a repo', ''] });
  assert.match(bad.out, /store= needs a repository as owner\/name/);
  assert.equal(bad.published.length, 0);
});

test('when GitHub cannot be searched, turning on makes nothing and says why', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const offline = { ...github, discoveryGh: () => ({ ok: false, reason: 'gh-unavailable' }) };
  const shown = await run(ctx, ['setup'], offline, { interactive: true, answers: [''] });
  assert.match(shown.out, /^- Store and parent issue: Not checked yet\. GitHub could not be read just now, so Toolkit asks about them once it can, and an answer now makes nothing\. Type toolkit governance again in a moment\.$/m);
  const answered = await run(ctx, ['setup'], offline, { interactive: true, answers: ['all recommended'] });
  assert.notEqual(answered.code, 0);
  assert.match(answered.out, /GitHub could not be read \(.+\), so the evidence store and parent issue could not be found or made\./, 'the answer says why');
  assert.deepEqual(github.calls, [], 'no store or issue is made on a guess');
  assert.equal(answered.published.length, 0);
});

test('a working tree with a programme file that turns governance on is a prepared adoption; a governed block is not needed', t => {
  const ctx = fixture(t);
  const file = path.join(ctx.repo, '.github', 'toolkit-programme.json');
  assert.equal(adopt.adoptionPrepared(ctx.repo), false);
  fs.writeFileSync(path.join(ctx.repo, 'AGENTS.md'), managedAgentsCopy());
  assert.equal(adopt.adoptionPrepared(ctx.repo), false, 'a governed block alone is not a prepared adoption');
  fs.rmSync(path.join(ctx.repo, 'AGENTS.md'));
  fs.writeFileSync(file, `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled' })}\n`);
  assert.equal(adopt.adoptionPrepared(ctx.repo), true, 'the programme file alone is prepared');
  // A merged programme file that turns governance off is the repository's decision, not a prepared yes.
  fs.writeFileSync(file, `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' })}\n`);
  assert.equal(adopt.adoptionPrepared(ctx.repo), false);
  fs.writeFileSync(file, 'not json\n');
  assert.equal(adopt.adoptionPrepared(ctx.repo), false);
});

test('parallel CI shards are a Toolkit default by CI time, not a question: slow CI gets them, fast CI and CI that already shards get none', async t => {
  const PASS = "const test = require('node:test');\ntest('ok', () => {});\n";
  const withTests = () => {
    const ctx = fixture(t);
    for (let index = 1; index <= 4; index += 1) {
      fs.mkdirSync(path.join(ctx.repo, 'test'), { recursive: true });
      fs.writeFileSync(path.join(ctx.repo, 'test', `case${index}.test.js`), PASS);
    }
    return ctx;
  };
  const slow = { minutes: 25, workflow: 'CI' };
  const ctx = withTests();
  const shown = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: [''], estimate: slow });
  assert.match(shown.out, /^- Parallel CI shards: Yes \(Toolkit default\) \(CI about 25 min\)\. The turn-on pull request also adds a first shard list and the shard workflows, because the last green CI run took 10 minutes or more; the split is then refreshed once a day\. To skip them, add shards=not-now or shards=never to your reply\.$/m);
  assert.doesNotMatch(shown.out, /\| Parallel CI shards \|/, 'never a question');
  const github = fakeGitHub();
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'], estimate: slow });
  assert.equal(result.code, 0, result.err + result.out);
  assert.equal(result.published.length, 1, 'still one turn-on pull request');
  const { binding, files } = result.published[0];
  assert.equal(binding.ci_shards.answer, 'yes');
  assert.match(binding.ci_shards.offered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const list = JSON.parse(files['.github/toolkit-test-shards.json']);
  assert.equal(list.systems.linux.shards.length, 3, '25 measured minutes: two named shards and the rest');
  assert.deepEqual(result.cloud.at(-1), { ciShards: 'yes' }, 'the shard copies follow this pull request\'s own answer, not an old read of the merged binding');
  assert.match(result.out, /a first \.github\/toolkit-test-shards\.json with 3 Linux shards .*travels in the turn-on pull request with the shard workflows/);
  // The override skips them, and never records never in the same one pull request.
  const skipped = await run(withTests(), ['setup'], fakeGitHub(), { interactive: true, answers: ['shards=not-now'], estimate: slow });
  assert.equal(skipped.code, 0, skipped.err + skipped.out);
  assert.equal(skipped.published[0].binding.ci_shards, undefined);
  const never = await run(withTests(), ['setup'], fakeGitHub(), { interactive: true, answers: ['1.1=A, shards=never'], estimate: slow });
  assert.equal(never.published[0].binding.ci_shards.answer, 'never');
  assert.equal(never.published[0].files['.github/toolkit-test-shards.json'], undefined);

  // Fast or unknown CI keeps none, so all recommended turns governance on without shards.
  const fast = await run(withTests(), ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], estimate: { minutes: 4, workflow: 'CI' } });
  assert.equal(fast.code, 0, fast.err + fast.out);
  assert.equal(fast.published[0].binding.ci_shards, undefined);
  assert.equal(fast.published[0].files['.github/toolkit-test-shards.json'], undefined);

  // CI that already runs its tests in parallel: shown as set, nothing offered or written, even when slow.
  const sharded = withTests();
  fs.mkdirSync(path.join(sharded.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(sharded.repo, '.github', 'workflows', 'validate.yml'), 'name: validate\non: [pull_request]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        shard: [1, 2, 3]\n    steps:\n      - run: npm test -- --shard=${{ matrix.shard }}/3\n');
  const already = await run(sharded, ['setup'], fakeGitHub(), { interactive: true, answers: [''], estimate: slow });
  assert.match(already.out, /^- Parallel CI shards: Already in your CI \(\.github\/workflows\/validate\.yml\)\.$/m);
  const kept = await run(sharded, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], estimate: slow });
  assert.equal(kept.code, 0, kept.err + kept.out);
  assert.equal(kept.published[0].binding.ci_shards, undefined);
  assert.equal(kept.published[0].files['.github/toolkit-test-shards.json'], undefined);
  const refused = await run(sharded, ['setup'], fakeGitHub(), { interactive: true, answers: ['shards=yes', ''], estimate: slow });
  assert.match(refused.out, /Parallel CI shards have no Toolkit default to change in this bank/);
  assert.equal(refused.published.length, 0);
});

test('the bank reads the open governance pull requests again: one closed outside Toolkit no longer holds the turn-on, and an open one is named', async t => {
  const ctx = fixture(t);
  const first = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'] });
  assert.equal(first.code, 0, first.err + first.out);
  assert.equal(first.published.length, 1);
  // The owner closed that pull request on GitHub; the last read on this computer still lists it.
  const again = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'] });
  assert.equal(again.code, 0, again.err + again.out);
  assert.equal(again.published.length, 1, 'a new turn-on pull request is prepared');
  assert.doesNotMatch(again.out + again.err, /not ready/);
  const open = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], opened: [PROPOSAL] });
  assert.equal(open.code, 0, open.err + open.out);
  assert.equal(open.published.length, 0, 'never a second one');
  assert.match(open.out, /^A governance pull request is already open, so no second one was prepared: https:\/\/github\.com\/toolkit-test-fixture\/fresh\/pull\/4 \(turns governance on\)\. Merge it, or close it and type toolkit governance to answer again\. Nothing was written, and the rest of this answer was not used\.$/m);
});
