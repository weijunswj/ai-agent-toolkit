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
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));

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
// `protectedChecks` are the check names a ruleset already requires on the default branch.
function fakeGitHub({ repos = {}, issues = [], failIssue = false, protectedChecks = [] } = {}) {
  const calls = [];
  const world = { repos: { ...repos }, issues: [...issues], nextIssue: 7 };
  const get = (endpoint) => {
    const url = endpoint.split('?')[0];
    if (url === `repos/${SLUG}/issues`) return { ok: true, value: world.issues };
    if (url === 'user/repos') return { ok: true, value: Object.keys(world.repos).map(full => ({ name: full.split('/')[1], owner: { login: OWNER } })) };
    if (url === `repos/${SLUG}`) return { ok: true, value: { default_branch: 'main' } };
    if (url === `repos/${SLUG}/rules/branches/main`) return { ok: true, value: protectedChecks.length ? [{ type: 'required_status_checks', parameters: { required_status_checks: protectedChecks.map(context => ({ context })) } }] : [] };
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

// What the real installer renders into the turn-on's folder: every turn-on pull request must carry these.
function writePlainText(into) {
  for (const name of ['.github/plain-text.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml']) {
    fs.mkdirSync(path.dirname(path.join(into, name)), { recursive: true });
    fs.writeFileSync(path.join(into, name), `${name}\n`);
  }
}

const PROPOSAL = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };

// `opened` is what GitHub lists as open governance pull requests when the run starts.
// `realPlainText` runs the real plain-text installer instead of the fixture's.
async function run(ctx, argv, github, { answers = [], interactive = false, plainTextFails = false, estimate = null, opened = [], cloudFiles = () => ({ files: {}, warning: null }), realPlainText = false } = {}) {
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
    discoveryGh: github.discoveryGh, adoptionWriter: github.writer,
    ...(realPlainText ? {} : { plainTextInstaller: (root, into) => { if (plainTextFails) throw Object.assign(new Error('The plain-text check could not be installed.'), { code: 'FIXTURE' }); plainText.push(root); writePlainText(into); } }),
    proposalTransport: { list: () => open, publish: (repository, binding, files) => { published.push({ binding, files }); open = [{ ...proposal, answer: binding.governance === 'disabled' ? 'no' : 'yes' }]; return open[0]; }, read: () => open[0] || proposal },
    cloudWorkflows: (cwd, options) => { cloud.push(options); return cloudFiles(cwd, options); },
    ...(estimate ? { ciEstimator: () => estimate } : {}),
  });
  const code = await cli.main(argv);
  return { code, out, err, published, plainText, cloud };
}

test('a fresh repository asks the three questions, names its store, and all recommended makes the store and parent and one turn-on pull request', async t => {
  const ctx = fixture(t, { agents: '# My own rules\n\nKeep this exactly.\n' });
  const github = fakeGitHub();
  const shown = await run(ctx, ['setup', '--json'], github);
  const questions = JSON.parse(shown.out).questions;
  assert.ok(questions.some(spec => spec.id === 'evidence-store'), 'the rows Toolkit read are still given as data');
  const guidedText = (await run(ctx, ['setup'], github, { interactive: true, answers: [''] })).out;
  assert.match(guidedText, /^\*\*1\. Question: Turn on GitHub governance for toolkit-test-fixture\/fresh\?\*\*$/m);
  // The store is named before the answer: this repository's own TRANSPORT-<name>, to be created.
  assert.match(guidedText, /Suggested: toolkit-test-fixture\/TRANSPORT-fresh, path `state\/toolkit-test-fixture\/fresh\/`\. Toolkit creates it if it does not exist yet\./);
  assert.match(guidedText, /^\*\*2\. Question: Keep records in toolkit-test-fixture\/TRANSPORT-fresh\?\*\*$/m);
  assert.match(guidedText, /^\*\*3\. Question: Turn on task auto-merge with merge train\?\*\*$/m);
  assert.equal(github.calls.length, 0, 'showing the questions makes nothing');

  const before = fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8');
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(result.code, 0, result.err + result.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md'], ['issue', SLUG, 'Programme: fresh']]);
  assert.match(result.out, /Made on GitHub: private evidence store toolkit-test-fixture\/TRANSPORT-fresh, parent issue #7\./);
  assert.match(result.out, /^Store: toolkit-test-fixture\/TRANSPORT-fresh, a private GitHub repository \(created for this repository\), for programme records and evidence\.$/m);
  assert.equal(result.published.length, 1, 'one turn-on pull request');
  const { binding, files } = result.published[0];
  assert.deepEqual(binding.parents, [{ issue: 7, record_prefix: 'INT-FRE7-' }]);
  assert.deepEqual(binding.store, { kind: 'github', repository: STORE, branch: 'main', path: `state/${SLUG}/` });
  assert.deepEqual(binding.task_prs, { auto_merge: 'after-gates', merge_train: 'on' }, 'task auto-merge with merge train is recommended');
  assert.equal(binding.min_toolkit, require(path.join(scripts, 'toolkit-version.cjs')).readToolkitVersion());
  assert.deepEqual(JSON.parse(files['.github/toolkit-programme.json']), binding);
  // The installed Toolkit delivers the governed rules, so the pull request carries the programme file
  // and the CI checks only. (The fake renders no cloud workflows; toolkit-default-cloud-workflows.test.cjs covers those.)
  assert.deepEqual(Object.keys(files).sort(), ['.github/dependabot.yml', '.github/plain-text.json', '.github/scripts/plain-text-check.cjs',
    '.github/toolkit-programme.json', '.github/workflows/plain-text.yml']);
  assert.match(files['.github/dependabot.yml'], /package-ecosystem: "?github-actions"?/);
  assert.match(result.out, /Added \.github\/dependabot\.yml to the turn-on pull request; nothing was written to your checkout\./);
  assert.equal(fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8'), before, 'the repository\'s own AGENTS.md is not changed');
  assert.ok(!fs.existsSync(path.join(ctx.repo, 'CLAUDE.md')));
  assert.equal(result.plainText.length, 1);
  // The owner's commands (Toolkit permissions, the Governance App) come in the summary after the merge.
  assert.doesNotMatch(result.out, /toolkit-governance-app-setup|```/, 'no command before the merge');
  // Task auto-merge off in the same answer: both switches off.
  const auto = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['1A 2A 3B'] });
  assert.equal(auto.code, 0, auto.err + auto.out);
  assert.deepEqual(auto.published[0].binding.task_prs, { auto_merge: 'off', merge_train: 'off' });
});

// Red on the parent: the pull request carried no guard, and nothing said a sweep follows.
test('the one turn-on pull request carries every default cloud workflow, says what the guard never scans, and notes the first sweep', async t => {
  const workflows = require(path.join(scripts, 'toolkit-cloud-workflows.cjs'));
  const finishing = require(path.join(scripts, 'toolkit-governance-finish.cjs'));
  const { cloudWorkflowFiles } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));
  const ROOT = path.resolve(scripts, '..', '..');
  const { SWEEPS, COPIED_FILES } = require('./support/default-cloud-workflows.cjs');
  const cloudFiles = (cwd, options) => cloudWorkflowFiles(cwd, { ...options, root: ROOT, commit: workflows.toolkitHead(ROOT) });
  const noted = ctx => finishing.entryFor(ctx.registryOptions, governance.governanceState(ctx.repo, ctx.registryOptions).repository_id).first_sweep;
  const ctx = fixture(t);
  const result = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], cloudFiles });
  assert.equal(result.code, 0, result.err + result.out);
  assert.equal(result.published.length, 1, 'one pull request');
  for (const file of [...SWEEPS.map(row => row.file), ...COPIED_FILES]) assert.equal(typeof result.published[0].files[file], 'string', file);
  assert.match(result.out, /^Personal data guard: checks each pull request and push on GitHub \(on a private repository that uses Actions minutes\), with no hooks on any computer\. It never scans commit author or committer addresses, and it passes images and fonts unread and names each one\.$/m);
  // Said before the owner approves the merge, since the finish turns these on without asking again.
  assert.match(result.out, /After the merge, Toolkit finishes the setup on its own: [^\n]*one report-only sweep of what is already there/);
  for (const name of ['personal-data-guard.yml', 'dependency-auto-merge.yml']) assert.equal(fs.existsSync(path.join(ctx.repo, '.github', 'workflows', name)), false, 'the working tree is not written');
  assert.equal(noted(ctx), true);
  // Someone's own file in the guard's place: it stays, the rest is carried, the owner is told, and no sweep is noted.
  const clash = fixture(t);
  fs.mkdirSync(path.join(clash.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(clash.repo, '.github', 'workflows', 'personal-data-guard.yml'), 'name: Mine\n');
  const kept = await run(clash, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], cloudFiles });
  assert.equal(kept.code, 0, kept.err + kept.out);
  assert.match(kept.out, /^\.github\/workflows\/personal-data-guard\.yml is not a Toolkit copy, so it is left as it is/m);
  assert.doesNotMatch(kept.out, /^Personal data guard: checks/m);
  assert.equal(kept.published[0].files['.github/scripts/personal-data-guard.cjs'], undefined);
  assert.equal(typeof kept.published[0].files['.github/workflows/dependency-auto-merge.yml'], 'string');
  assert.equal(noted(clash), false);
});

// Red on the parent (the 27 Nov owner test): the turn-on wrote the plain-text check and Dependabot
// settings into the checkout, which the merged pull request then also held, so the session-start
// catch-up refused to move the default branch; and the binding required no checks, so the owner was
// asked to edit required_checks and run migrate.
test('a turn-on leaves the checkout exactly as it was, carries the same 13 files and requires its own checks', async t => {
  const workflows = require(path.join(scripts, 'toolkit-cloud-workflows.cjs'));
  const { cloudWorkflowFiles } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));
  const ROOT = path.resolve(scripts, '..', '..');
  const { SWEEPS, COPIED_FILES } = require('./support/default-cloud-workflows.cjs');
  const cloudFiles = (cwd, options) => cloudWorkflowFiles(cwd, { ...options, root: ROOT, commit: workflows.toolkitHead(ROOT) });
  // A link the plain-text check flags, so the starting baseline is made from what the checkout holds.
  const ctx = fixture(t, { agents: '# Rules\n\nSee https://github.com/example-owner/example-repo/issues/3 for the history.\n' });
  const status = () => require('node:child_process').execFileSync('git', ['-C', ctx.repo, 'status', '--porcelain', '--untracked-files=all', '--ignored'], { encoding: 'utf8', windowsHide: true });
  const before = status();
  assert.equal(before, '?? AGENTS.md\n');
  const result = await run(ctx, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], cloudFiles, realPlainText: true });
  assert.equal(result.code, 0, result.err + result.out);
  assert.equal(status(), before, 'nothing was added to or changed in the checkout');
  assert.equal(result.published.length, 1);
  const { binding, files } = result.published[0];
  const expected = ['.github/toolkit-programme.json', '.github/plain-text.json', '.github/plain-text-baseline.json', '.github/scripts/plain-text-check.cjs',
    '.github/workflows/plain-text.yml', '.github/dependabot.yml', ...SWEEPS.map(row => row.file), ...COPIED_FILES];
  assert.deepEqual(Object.keys(files).sort(), [...new Set(expected)].sort());
  assert.equal(Object.keys(files).length, 13);
  const baseline = JSON.parse(files['.github/plain-text-baseline.json']);
  assert.deepEqual(baseline.allowed.map(entry => [entry.file, entry.rule]), [['AGENTS.md', 'github-link']], 'the baseline is made from the checkout\'s own text');
  assert.match(files['.github/scripts/plain-text-check.cjs'], /^\/\/ AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED plain-text-check /m);
  // The checks the pull request's own workflows run are required, with nothing for the owner to add.
  assert.deepEqual(binding.required_checks, ['personal-data', 'plain-text']);
  assert.deepEqual(JSON.parse(files['.github/toolkit-programme.json']).required_checks, ['personal-data', 'plain-text']);
  assert.match(result.out, /^Required checks: personal-data, plain-text\. Toolkit sets them in the programme file, so every pull request passes them before it lands\.$/m);
  // No owner step to edit required_checks, run migrate or pull, and every owner command in a PowerShell block.
  const answered = result.out.slice(result.out.indexOf('The plain-text check files travel'));
  assert.ok(answered.length < result.out.length, 'the answer follows the bank');
  for (const step of [/required_checks/, /\bmigrate\b/, /(?<![/\w])pull(?:ing)?\b(?! requests?\b)(?!\/)/, /untracked/]) assert.doesNotMatch(answered, step);
  assert.match(files['.github/dependabot.yml'], /package-ecosystem: "?github-actions"?/, 'the rendered workflows count for Dependabot');
  assert.match(result.out, /^Nothing was written to your checkout, so after the merge the next session here can bring your local default branch up to date on its own\.$/m);
  // The owner's commands come in the summary after the merge (each in a PowerShell block there), never here.
  assert.doesNotMatch(result.out, /```|^node "/m);

  // Checks the default branch already requires are kept next to Toolkit's own.
  const kept = fixture(t);
  const protectedRun = await run(kept, ['setup'], fakeGitHub({ protectedChecks: ['validate'] }), { interactive: true, answers: ['all recommended'], cloudFiles });
  assert.equal(protectedRun.code, 0, protectedRun.err + protectedRun.out);
  assert.deepEqual(protectedRun.published[0].binding.required_checks, ['personal-data', 'validate'], 'the fixture installer\'s plain-text workflow defines no job, so only the guard\'s check is added');
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
  const mixed = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['no store, 3A', ''] });
  assert.match(mixed.out, /No store keeps governance off, so answer it on its own/);
  assert.equal(mixed.published.length, 0);
});

// 1485 G2 L3: the setup takes the session-start question's plain yes, no and later: yes is all
// recommended, later is no store, and no makes the one off pull request.
test('the guided setup takes a plain yes, no or later', async t => {
  const shown = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: [''] });
  assert.match(shown.out, /^   - \*\*A\. Yes \(my pick\):\*\* .*\n   - \*\*B\. Later:\*\* .*\n   - \*\*C\. No:\*\* /m);
  const yesGitHub = fakeGitHub();
  const yes = await run(fixture(t), ['setup'], yesGitHub, { interactive: true, answers: ['Yes.'] });
  assert.equal(yes.code, 0, yes.err + yes.out);
  assert.equal(yes.published.length, 1);
  assert.equal(yes.published[0].binding.governance, 'enabled');
  assert.deepEqual(yesGitHub.calls, [['create', STORE], ['put', STORE, 'archives/README.md'], ['issue', SLUG, yesGitHub.calls[2][2]]], 'the same as all recommended');
  const laterGitHub = fakeGitHub();
  const later = await run(fixture(t), ['setup'], laterGitHub, { interactive: true, answers: ['later'] });
  assert.equal(later.code, 0, later.err + later.out);
  assert.match(later.out, /^Later: nothing was written, and governance stays off\. Toolkit asks again next session\.$/m);
  assert.deepEqual(laterGitHub.calls, []);
  assert.equal(later.published.length, 0);
  const noGitHub = fakeGitHub();
  const noCtx = fixture(t);
  const no = await run(noCtx, ['setup'], noGitHub, { interactive: true, answers: ['no'] });
  assert.equal(no.code, 0, no.err + no.out);
  assert.deepEqual(noGitHub.calls, [], 'no store or parent issue for an off decision');
  assert.equal(no.published.length, 1);
  assert.deepEqual(no.published[0].binding, { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' });
  assert.equal(governance.governanceState(noCtx.repo, noCtx.registryOptions).state, 'UNDECIDED', 'nothing decides until it merges');
  // Anything more than a plain word or the letters is not read.
  const unclear = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['no thanks', ''] });
  assert.match(unclear.out, /This part of the answer was not read: "no thanks"/);
  assert.equal(unclear.published.length, 0);
});

// The questions stay open after a used answer, so a yes or a no meant for something else could reach
// them: after "later", a stray yes made the store, the parent issue and the pull request. Plain words
// answer them once; the letters still do.
test('the plain words answer the guided setup once: after a used answer a yes or a no is not read, and the letters still are', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const epochs = new gate.SessionEpochs({ registryOptions: ctx.registryOptions });
  epochs.start('session-adopt', 'startup', governance.governanceState(ctx.repo, ctx.registryOptions).repository_id);
  const tickets = new BankTickets({ registryOptions: ctx.registryOptions });
  await run(ctx, ['setup'], github);
  const reference = tickets.pendingFor('session-adopt', epochs.get('session-adopt')).bank_reference;
  const reply = answer => run(ctx, ['setup', '--answers', `${reference}: ${answer}`, '--ticket', tickets.issue('session-adopt', epochs.get('session-adopt'))], github);
  // An answer that could not be read is not a used one: the plain word after it is the first answer.
  assert.match((await reply('maybe')).out, /This part of the answer was not read/);
  const later = await reply('later');
  assert.match(later.out, /^Later: nothing was written, and governance stays off\./m);
  for (const word of ['yes', 'no', 'later', 'Yes.']) {
    const stray = await reply(word);
    assert.match(stray.out, /^Your earlier answer was already used, and this reply changes nothing\. Nothing more was written\.$/m, word);
    assert.deepEqual([github.calls, stray.published], [[], []], word);
  }
  const listed = await reply('1A 2A 3A');
  assert.equal(listed.code, 0, listed.err + listed.out);
  assert.equal(listed.published[0].binding.governance, 'enabled');
});

test('a failed step stops with what was made, and answering again reuses it instead of making a second one', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub({ failIssue: true });
  const failed = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(failed.code, 2);
  assert.match(failed.out, /The parent issue could not be opened \(gh-request-failed\)\. No pull request was prepared\./);
  assert.match(failed.out, /Already made, and reused when you answer again: private evidence store toolkit-test-fixture\/TRANSPORT-fresh\./);
  assert.match(failed.out, /^Once the cause is fixed, type toolkit governance and answer again\.$/m);
  assert.equal(failed.published.length, 0);

  const retry = fakeGitHub({ repos: github.world.repos });
  const shown = await run(ctx, ['setup'], retry, { interactive: true, answers: [''] });
  assert.match(shown.out, /Suggested: toolkit-test-fixture\/TRANSPORT-fresh, path `[^`]+`\. It already exists\./, 'the store made last time is found, not offered again');
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
  assert.match(shown.out, /Suggested: toolkit-test-fixture\/TRANSPORT-fresh, path `[^`]+`\. Toolkit creates it if it does not exist yet\./);
  assert.doesNotMatch(shown.out, /TRANSPORT-elsewhere|fresh-evidence/, 'the other stores are not offered');
  const made = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(made.code, 0, made.err + made.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md']]);
  assert.equal(made.published[0].binding.store.repository, STORE);
  assert.equal(made.published[0].binding.parents[0].issue, 3);

  // Named (Another repository): used when it reads back as a private store of the same owner, and nothing is created.
  const named = fakeGitHub({ repos: { [other]: { private: true, dirs: ['archives'] } }, issues: [parent] });
  const used = await run(fixture(t), ['setup'], named, { interactive: true, answers: [`1A 2B ${other} 3A`] });
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
  // The task repository itself, even private and laid out like a store, is refused for that reason
  // before any parent issue is made (1460 G2 L1: main made parent #7 first, then gave the wrong reason).
  const itself = fakeGitHub({ repos: { [SLUG]: { private: true, dirs: ['state'] } } });
  const selfCtx = fixture(t);
  const self = await run(selfCtx, ['setup'], itself, { interactive: true, answers: [`store=${SLUG.toUpperCase()}`] });
  assert.notEqual(self.code, 0);
  assert.match(self.out, /^TOOLKIT-TEST-FIXTURE\/FRESH is this repository itself, so it was not used as the evidence store: the store must be a separate private repository\. No pull request was prepared\.$/m);
  assert.match(self.out, /^Nothing was made on GitHub\.$/m);
  assert.deepEqual(itself.calls, [], 'no parent issue, store or file');
  assert.equal(self.published.length, 0);
  assert.equal(fs.existsSync(path.join(selfCtx.repo, '.github', 'plain-text.json')), false, 'no local write either');
  // Nor the shard list, which joins the answer by default where CI is slow.
  fs.mkdirSync(path.join(selfCtx.repo, 'test'), { recursive: true });
  for (let index = 1; index <= 4; index += 1) fs.writeFileSync(path.join(selfCtx.repo, 'test', `case${index}.test.js`), "require('node:test')('ok', () => {});\n");
  const slow = await run(selfCtx, ['setup'], itself, { interactive: true, answers: [`store=${SLUG}`], estimate: { minutes: 25, workflow: 'CI' } });
  assert.equal(slow.code, 2);
  assert.match(slow.out, /is this repository itself/);
  assert.equal(fs.existsSync(path.join(selfCtx.repo, '.github', 'toolkit-test-shards.json')), false);
  // A malformed name is refused as unreadable, nothing written.
  const bad = await run(fixture(t), ['setup'], fakeGitHub(), { interactive: true, answers: ['store=not a repo', ''] });
  assert.match(bad.out, /This part of the answer was not read: "store=not a repo"/);
  assert.equal(bad.published.length, 0);
});

test('when GitHub cannot be searched, the questions are not shown and nothing is made', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const offline = { ...github, discoveryGh: () => ({ ok: false, reason: 'gh-unavailable' }) };
  for (const answers of [[''], ['all recommended']]) {
    const shown = await run(ctx, ['setup'], offline, { interactive: true, answers });
    assert.equal(shown.code, 1);
    assert.match(shown.out, /^GitHub could not be read just now, so Toolkit cannot find or suggest the evidence store and parent issue yet, and the setup questions are not shown\. Nothing changed\. Type toolkit governance again in a moment\.$/m);
    assert.doesNotMatch(shown.out, /Question: |gh-unavailable/, 'no questions, and no internal reason');
  }
  assert.deepEqual(github.calls, [], 'no store or issue is made on a guess');
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

test('parallel CI shards are a Toolkit default by CI time, never a question: slow CI gets them, fast CI and CI that already shards get none', async t => {
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
  assert.doesNotMatch(shown.out, /shards/i, 'never a question');
  const github = fakeGitHub();
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'], estimate: slow });
  assert.equal(result.code, 0, result.err + result.out);
  assert.equal(result.published.length, 1, 'still one turn-on pull request');
  const { binding, files } = result.published[0];
  assert.equal(binding.ci_shards.answer, 'yes');
  assert.match(binding.ci_shards.offered_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const list = JSON.parse(files['.github/toolkit-test-shards.json']);
  assert.equal(list.systems.linux.shards.length, 3, '25 measured minutes: two named shards and the rest');
  assert.equal(result.cloud.at(-1).ciShards, 'yes', 'the shard copies follow this pull request\'s own answer, not an old read of the merged binding');
  assert.ok(path.relative(ctx.repo, result.cloud.at(-1).overlay).startsWith('..'), 'the render folder is not in the checkout');
  assert.equal(fs.existsSync(path.join(ctx.repo, '.github', 'toolkit-test-shards.json')), false, 'the shard list is not written to the checkout');
  assert.equal(fs.existsSync(result.cloud.at(-1).overlay), false, 'the render folder is removed after the answer');
  assert.match(result.out, /a first \.github\/toolkit-test-shards\.json with 3 Linux shards .*travels in the turn-on pull request with the shard workflows/);
  // Fast or unknown CI keeps none.
  const fast = await run(withTests(), ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], estimate: { minutes: 4, workflow: 'CI' } });
  assert.equal(fast.code, 0, fast.err + fast.out);
  assert.equal(fast.published[0].binding.ci_shards, undefined);
  assert.equal(fast.published[0].files['.github/toolkit-test-shards.json'], undefined);
  // CI that already runs its tests in parallel: nothing written, even when slow.
  const sharded = withTests();
  fs.mkdirSync(path.join(sharded.repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(sharded.repo, '.github', 'workflows', 'validate.yml'), 'name: validate\non: [pull_request]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        shard: [1, 2, 3]\n    steps:\n      - run: npm test -- --shard=${{ matrix.shard }}/3\n');
  const kept = await run(sharded, ['setup'], fakeGitHub(), { interactive: true, answers: ['all recommended'], estimate: slow });
  assert.equal(kept.code, 0, kept.err + kept.out);
  assert.equal(kept.published[0].binding.ci_shards, undefined);
  assert.equal(kept.published[0].files['.github/toolkit-test-shards.json'], undefined);
});

test('the setup reads the open governance pull requests again: one closed outside Toolkit no longer holds the turn-on, and an open one is named', async t => {
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
  assert.match(open.out, /Merge it, or close it and type toolkit governance to answer again\. Nothing was written\.$/m);
  assert.doesNotMatch(open.out, /Question: /, 'no questions while it is open');
});
