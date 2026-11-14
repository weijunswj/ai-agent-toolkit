'use strict';

// Turning governance on in a fresh repository from the governance question bank: the bank shows the
// store, parent issue and checks as status lines (or the store as a question when one is found), and
// the owner's answer makes the missing store and parent issue, renders the governed rules from the
// templates and publishes one turn-on pull request. Offline fakes stand in for GitHub.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeGoverned, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const adopt = require(path.join(scripts, 'toolkit-governance-adopt.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));

const OWNER = 'toolkit-test-fixture';
const SLUG = `${OWNER}/fresh`;
const STORE = `${OWNER}/TRANSPORT-fresh`;
const PLAYBOOKS = fs.readdirSync(path.join(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local', 'docs', 'agent-playbooks')).filter(name => name.endsWith('.md'));

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

async function run(ctx, argv, github, { answers = [], interactive = false, plainTextFails = false } = {}) {
  let out = ''; let err = '';
  const published = [];
  let open = [];
  const proposal = { repository: SLUG, number: 4, head: 'e'.repeat(40), url: `https://github.com/${SLUG}/pull/4`, state: 'open', answer: 'yes' };
  const plainText = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, registryOptions: ctx.registryOptions,
    ask: async () => answers.shift() ?? '',
    refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
    permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), environment: { TOOLKIT_HOST_SESSION: 'session-adopt' },
    discoveryGh: github.discoveryGh, adoptionWriter: github.writer, plainTextInstaller: root => { if (plainTextFails) throw Object.assign(new Error('The plain-text check could not be installed.'), { code: 'FIXTURE' }); plainText.push(root); },
    proposalTransport: { list: () => open, publish: (repository, binding, files) => { published.push({ binding, files }); open = [proposal]; return proposal; }, read: () => proposal },
    cloudWorkflows: () => ({ files: {}, warning: null }),
  });
  const code = await cli.main(argv);
  return { code, out, err, published, plainText };
}

test('a fresh repository shows what turning on makes, and all recommended makes the store and parent and one turn-on pull request', async t => {
  const ctx = fixture(t, { agents: '# My own rules\n\nKeep this exactly.\n' });
  const github = fakeGitHub();
  const shown = await run(ctx, ['setup', '--json'], github);
  const questions = JSON.parse(shown.out).questions;
  assert.deepEqual(questions.map(spec => [spec.id, Boolean(spec.report_only)]), [['governance', false], ['task-auto-merge', false], ['evidence-store', true], ['parent-issue', true], ['required-checks', true], ['permission-blocks', false]]);
  const table = (await run(ctx, ['setup'], github, { interactive: true, answers: [''] })).out;
  assert.match(table, /\| 1\.1 \| GitHub governance \| Not decided \| B\. Turn on/);
  assert.match(table, /Evidence store: None yet\. Toolkit creates a private TRANSPORT-fresh when governance turns on/);
  assert.match(table, /Parent issue: None yet\. Toolkit opens one when governance turns on/);
  assert.equal(github.calls.length, 0, 'showing the bank makes nothing');

  const before = fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8');
  const result = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(result.code, 0, result.err + result.out);
  assert.deepEqual(github.calls, [['create', STORE], ['put', STORE, 'archives/README.md'], ['issue', SLUG, 'Programme: fresh']]);
  assert.match(result.out, /Made on GitHub: private evidence store toolkit-test-fixture\/TRANSPORT-fresh, parent issue #7\./);
  assert.equal(result.published.length, 1, 'one turn-on pull request');
  const { binding, files } = result.published[0];
  assert.deepEqual(binding.parents, [{ issue: 7, record_prefix: 'INT-FRE7-' }]);
  assert.deepEqual(binding.store, { kind: 'github', repository: STORE, branch: 'main', path: `state/${SLUG}/` });
  assert.deepEqual(binding.task_prs, { auto_merge: 'off' });
  assert.deepEqual(JSON.parse(files['.github/toolkit-programme.json']), binding);
  const { blocks, errors } = managedBlock.findBlocks(files['AGENTS.md']);
  assert.equal(errors.length, 0);
  assert.ok(blocks.some(block => block.name === 'TOOLKIT-GOVERNED-RULES'));
  assert.ok(files['AGENTS.md'].endsWith('\n\n# My own rules\n\nKeep this exactly.\n'), 'text outside the markers keeps its bytes');
  assert.equal(files['CLAUDE.md'], '@AGENTS.md\n');
  for (const name of PLAYBOOKS) assert.ok(files[`docs/agent-playbooks/${name}`], name);
  assert.equal(fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8'), before, 'the working tree is not changed');
  assert.ok(!fs.existsSync(path.join(ctx.repo, 'CLAUDE.md')));
  assert.equal(result.plainText.length, 1);
});

test('a failed step stops with what was made, and answering again reuses it instead of making a second one', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub({ failIssue: true });
  const failed = await run(ctx, ['setup'], github, { interactive: true, answers: ['all recommended'] });
  assert.equal(failed.code, 2);
  assert.match(failed.out, /The parent issue could not be opened \(gh-request-failed\)\. No pull request was prepared\./);
  assert.match(failed.out, /Already made, and reused when you answer again: private evidence store toolkit-test-fixture\/TRANSPORT-fresh\./);
  assert.equal(failed.published.length, 0);

  const retry = fakeGitHub({ repos: github.world.repos });
  const shown = await run(ctx, ['setup'], retry, { interactive: true, answers: [''] });
  assert.match(shown.out, /Evidence store: TRANSPORT-fresh\. Reused when governance turns on/, 'the store made last time is found, not offered again');
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

test('a found store is a question: keep it, or create a new private one', async t => {
  const ctx = fixture(t);
  const found = `${OWNER}/fresh-evidence`;
  const parent = { number: 3, title: 'Programme tracker', state: 'open', labels: [] };
  const keep = fakeGitHub({ repos: { [found]: { private: true, dirs: ['archives'] } }, issues: [parent] });
  const shown = await run(ctx, ['setup'], keep, { interactive: true, answers: [''] });
  assert.match(shown.out, /\| 1\.3 \| Evidence store \| fresh-evidence \| A\. Keep current \| B\. Create a new private store \|/);
  assert.match(shown.out, /Parent issue: #3\. Reused when governance turns on/);
  const kept = await run(ctx, ['setup'], keep, { interactive: true, answers: ['all recommended'] });
  assert.equal(kept.code, 0, kept.err + kept.out);
  assert.deepEqual(keep.calls, [], 'everything is reused');
  assert.equal(kept.published[0].binding.store.repository, found);
  assert.equal(kept.published[0].binding.parents[0].issue, 3);

  const ctx2 = fixture(t);
  const fresh = fakeGitHub({ repos: { [found]: { private: true, dirs: ['archives'] } }, issues: [parent] });
  const made = await run(ctx2, ['setup'], fresh, { interactive: true, answers: ['1.3=B'] });
  assert.equal(made.code, 0, made.err + made.out);
  assert.deepEqual(fresh.calls, [['create', STORE], ['put', STORE, 'archives/README.md']]);
  assert.equal(made.published[0].binding.store.repository, STORE);
});

test('when GitHub cannot be searched, turning on makes nothing and says why', async t => {
  const ctx = fixture(t);
  const github = fakeGitHub();
  const offline = { ...github, discoveryGh: () => ({ ok: false, reason: 'gh-unavailable' }) };
  const shown = await run(ctx, ['setup'], offline, { interactive: true, answers: [''] });
  assert.match(shown.out, /Store and parent issue: Could not be checked\. GitHub could not be read/);
  const answered = await run(ctx, ['setup'], offline, { interactive: true, answers: ['all recommended'] });
  assert.notEqual(answered.code, 0);
  assert.match(answered.out, /GitHub could not be read \(.+\), so the evidence store and parent issue could not be found or made\./, 'the answer says why');
  assert.deepEqual(github.calls, [], 'no store or issue is made on a guess');
  assert.equal(answered.published.length, 0);
});

test('a repository that already carries its prepared rules and programme file uses them and makes nothing', t => {
  const ctx = fixture(t);
  assert.equal(adopt.adoptionPrepared(ctx.repo), false);
  fs.copyFileSync(path.join(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'), path.join(ctx.repo, 'AGENTS.md'));
  assert.equal(adopt.adoptionPrepared(ctx.repo), false, 'the rules alone are not a prepared adoption');
  fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), '{}\n');
  assert.equal(adopt.adoptionPrepared(ctx.repo), true);
  const files = adopt.renderedRules(ctx.repo);
  assert.equal(files['AGENTS.md'], fs.readFileSync(path.join(ctx.repo, 'AGENTS.md'), 'utf8'), 'a current block renders unchanged');
});
