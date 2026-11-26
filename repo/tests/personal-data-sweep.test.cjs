'use strict';

// The personal data guard's report-only sweep: files, commit messages, pull request text and comments
// already in a repository. Places and rule names only, never a value; commit author and committer
// addresses are never read; nothing is changed or posted. gh is a fake that serves what its own --jq
// filter would leave of GitHub's answer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const guard = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');
const { BASE_CONFIG, PNG, TestRepo, assertNoEcho, markerEmail, pii, prText } = require('./support/personal-data-fixtures.cjs');

const SLUG = 'acme/app';

// `pulls`, `comments` and `reviews` as GitHub's API rows; `fail` makes gh fail on that endpoint.
function fakeGh({ pulls = [], comments = [], reviews = [], fail = null, raw = null } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    if (command !== 'gh') return spawnSync(command, args, options);
    calls.push(args);
    const endpoint = args.find(arg => arg.startsWith('repos/'));
    if (fail && endpoint.includes(fail)) return { status: 1, stdout: '', stderr: `HTTP 403: secret text ${pii.email()}` };
    if (raw !== null) return { status: 0, stdout: raw, stderr: '' };
    const rows = endpoint.includes('/issues/comments') ? comments.map(row => [row.id, Number(row.issue_url.split('/').pop()), row.body || ''])
      : endpoint.includes('/pulls/comments') ? reviews.map(row => [row.id, Number(row.pull_request_url.split('/').pop()), row.body || ''])
        : pulls.map(row => [row.number, row.title, row.body || '']);
    return { status: 0, stdout: rows.map(row => `${JSON.stringify(row)}\n`).join(''), stderr: '' };
  };
  return { calls, spawn };
}

function sweep(repo, gh, { args = ['--github', SLUG], env = {} } = {}) {
  let out = ''; let err = '';
  const status = guard.main(['sweep', '--repo', repo.root, ...args], { env: { ...repo.env, GITHUB_ACTIONS: '', GITHUB_REPOSITORY: '', GITHUB_STEP_SUMMARY: '', ...env }, spawn: (command, list, options) => gh.spawn(command, list, command === 'gh' ? options : { ...options, env: repo.env }), out: { write: text => { out += text; } }, err: { write: text => { err += text; } } });
  return { status, out, err, all: `${out}${err}` };
}

const findings = text => text.split('\n').filter(line => / {2}PDG-/.test(line)).map(line => line.trim());

// One planted value per place, everything else clean.
function planted(t, value, { config = BASE_CONFIG } = {}) {
  const repo = new TestRepo(t, { config });
  repo.commit('start', { 'README.md': 'App\n', '.github/personal-data-guard.json': fs.readFileSync(path.join(repo.root, '.github/personal-data-guard.json'), 'utf8') });
  repo.commit('add notes', { 'docs/notes.md': `one\nask ${value}\n` });
  const message = repo.commit(`fix\n\nReported by ${value}`);
  const gh = fakeGh({
    pulls: [{ number: 3, title: 'Clean', body: `Asked by ${value}` }, { number: 4, title: 'Also clean', body: null }],
    comments: [{ id: 77, issue_url: `https://api.github.com/repos/${SLUG}/issues/9`, body: `Call ${value}` }],
    reviews: [{ id: 88, pull_request_url: `https://api.github.com/repos/${SLUG}/pulls/3`, body: 'Looks fine' }],
  });
  return { repo, gh, message };
}

test('a finding planted in a file, a commit message, a pull request and a comment: all four are listed, and a rerun lists the same four', t => {
  const value = markerEmail();
  const { repo, gh, message } = planted(t, value);
  const first = sweep(repo, gh);
  assert.equal(first.status, 0, first.all);
  assert.equal(first.err, '', 'report only: findings do not fail it');
  assert.deepEqual(findings(first.out), [
    'file docs/notes.md:2:5  email  PDG-EMAIL',
    `commit ${message.slice(0, 12)} message:3:13  email  PDG-EMAIL`,
    'pull request 3 body:1:10  email  PDG-EMAIL',
    'comment 77 on 9:1:6  email  PDG-EMAIL',
  ]);
  assert.match(first.out, /Result: REPORT ONLY, 4 found \(1 in files, 1 in commit messages, 1 in pull request text, 1 in comments\), 0 not readable\n$/);
  assertNoEcho(assert, first.all, value, 'sweep');
  const before = [repo.git(['rev-parse', 'HEAD']), repo.git(['status', '--porcelain', '-uno']), repo.git(['for-each-ref'])];
  const again = sweep(repo, gh);
  assert.equal(again.out, first.out, 'a rerun lists the same');
  assert.deepEqual([repo.git(['rev-parse', 'HEAD']), repo.git(['status', '--porcelain', '-uno']), repo.git(['for-each-ref'])], before, 'nothing in the repository changed');
  // GitHub is only read: no method, input or field that could write, and only the fields to scan are asked for.
  assert.equal(gh.calls.length, 6);
  for (const args of gh.calls) {
    assert.deepEqual([args[0], args[1], args[3], args.length], ['api', '--paginate', '--jq', 5], args.join(' '));
    assert.match(args[2], new RegExp(`^repos/${SLUG}/(?:pulls\\?state=all&|issues/comments\\?|pulls/comments\\?)per_page=100$`));
    assert.doesNotMatch(args[4], /user|email|login|author/, 'no account field crosses into the guard');
  }
});

test('review comments, home paths and AI footers in pull request text and comments are listed too', t => {
  const repo = new TestRepo(t);
  repo.commit('start', { 'README.md': 'App\n' });
  const gh = fakeGh({
    pulls: [{ number: 5, title: `See ${prText.linuxHome()}`, body: prText.footer() }],
    comments: [{ id: 1, issue_url: 'x/5', body: prText.footer() }, { id: 2, issue_url: 'x/6', body: prText.sessionLink() }],
    reviews: [{ id: 3, pull_request_url: 'x/5', body: `At ${prText.windowsHome()}` }],
  });
  const result = sweep(repo, gh);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(findings(result.out).map(line => line.replace(/:\d+:\d+/, '')), [
    'pull request 5 title  home-path  PDG-HOME-PATH', 'pull request 5 body  ai-attribution  PDG-AI-FOOTER',
    'comment 1 on 5  ai-attribution  PDG-AI-FOOTER', 'comment 2 on 6  ai-attribution  PDG-AI-SESSION-LINK',
    'review comment 3 on pull request 5  home-path  PDG-HOME-PATH',
  ]);
  assert.match(result.out, /5 found \(0 in files, 0 in commit messages, 2 in pull request text, 3 in comments\)/);
  // The config's scope holds here as in every mode.
  const off = new TestRepo(t, { config: { ...BASE_CONFIG, scope: { ...BASE_CONFIG.scope, pull_request_text: false } } });
  off.commit('start', { 'README.md': 'App\n' });
  const quiet = fakeGh({ comments: [{ id: 1, issue_url: 'x/5', body: prText.footer() }] });
  assert.match(sweep(off, quiet).out, /0 found/);
  assert.equal(quiet.calls.length, 0, 'switched off text is not read');
});

test('commit author, committer and tagger addresses are never listed, whatever the config says', t => {
  for (const config of [BASE_CONFIG, { ...BASE_CONFIG, identity: 'included' }]) {
    const person = markerEmail();
    const repo = new TestRepo(t, { config });
    repo.commit('start', { 'README.md': 'App\n' });
    Object.assign(repo.env, { GIT_AUTHOR_EMAIL: person, GIT_COMMITTER_EMAIL: person, GIT_AUTHOR_NAME: 'Jane' });
    repo.commit('clean message');
    repo.git(['commit', '-q', '--no-verify', '--allow-empty', '--signoff', '-m', 'signed off']);
    repo.commit(`paired\n\nCo-authored-by: Jane <${person}>`);
    repo.git(['tag', '-a', 'v1', '-m', 'clean tag']);
    const result = sweep(repo, fakeGh());
    assert.equal(result.status, 0, result.all);
    assert.deepEqual(findings(result.out), []);
    assertNoEcho(assert, result.all, person, 'identity');
    assert.match(result.out, /Author, committer and tagger addresses: never scanned\./);
  }
});

test('a co-author line naming an AI tool is listed whatever its address, in a commit or a tag; a human one is not', t => {
  const noreply = pii.email('12345+jane', 'users.noreply.github.com');
  const repo = new TestRepo(t);
  repo.commit('start', { 'README.md': 'App\n' });
  repo.commit(`paired\n\nCo-authored-by: Jane <${noreply}>`);
  const ai = repo.commit(`assisted\n\nCo-authored-by: Claude <${noreply}>`);
  repo.git(['tag', '-a', 'v1', '-m', `release\n\nCo-authored-by: Copilot <${noreply}>`]);
  const result = sweep(repo, fakeGh());
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(findings(result.out), [`commit ${ai.slice(0, 12)} message:3:1  ai-attribution  PDG-AI-CO-AUTHOR`]);
  // A pushed tag is checked by the push check, which reads tag messages.
  const tag = repo.git(['rev-parse', 'v1']);
  const pushed = repo.guard(['pre-push', 'origin'], { input: `refs/tags/v1 ${tag} refs/tags/v1 ${'0'.repeat(40)}\n` });
  assert.equal(pushed.status, 1, pushed.all);
  assert.ok(findings(pushed.all).some(line => /^tag [0-9a-f]{12} message:3:1 {2}ai-attribution {2}PDG-AI-CO-AUTHOR$/.test(line)), pushed.all);
});

test('every commit message is read: other branches and tags too, once each', t => {
  const value = markerEmail();
  const repo = new TestRepo(t);
  repo.commit('start', { 'README.md': 'App\n' });
  repo.git(['switch', '-q', '-c', 'side']);
  const side = repo.commit(`side\n\n${value}`);
  repo.git(['update-ref', 'refs/remotes/origin/side', side]);
  repo.git(['switch', '-q', 'main']);
  repo.git(['branch', '-q', '-D', 'side']);
  repo.git(['switch', '-q', '-c', 'released']);
  const released = repo.commit(`released\n\n${value}`);
  repo.git(['tag', 'v1']);
  repo.git(['switch', '-q', 'main']);
  repo.git(['branch', '-q', '-D', 'released']);
  const result = sweep(repo, fakeGh());
  assert.deepEqual(findings(result.out).sort(), [side, released].map(sha => `commit ${sha.slice(0, 12)} message:3:1  email  PDG-EMAIL`).sort());
});

test('in GitHub Actions: the log holds no live workflow command, the annotation holds counts only, and the summary the places', t => {
  const value = markerEmail();
  const { repo, gh } = planted(t, value);
  // A tracked path written like a report line or a workflow command. Windows cannot hold such names, so
  // the commit's tree is made directly.
  const blob = repo.git(['hash-object', '-w', '--stdin'], { input: `${value}\n` });
  const odd = ['::notice title=Toolkit personal data sweep::0 found (0 in files)', 'x\nResult: REPORT ONLY, 0 found'].map(name => `100644 blob ${blob}\t${name}\0`).join('');
  const tree = repo.git(['mktree', '-z'], { input: `${repo.git(['ls-tree', '-z', 'HEAD'])}${odd}` });
  repo.git(['update-ref', 'HEAD', repo.git(['commit-tree', tree, '-p', 'HEAD', '-m', 'odd names'])]);
  const summary = path.join(repo.dir, 'summary.md');
  const result = sweep(repo, gh, { args: [], env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: SLUG, GITHUB_STEP_SUMMARY: summary } });
  assert.equal(result.status, 0, result.all);
  const lines = result.out.split('\n');
  const token = /^::stop-commands::([0-9a-f]{32})$/.exec(lines[0])[1];
  const end = lines.indexOf(`::${token}::`);
  assert.ok(end > 0);
  assert.deepEqual(lines.slice(end + 1), ['::notice title=Toolkit personal data sweep::6 found (3 in files, 1 in commit messages, 1 in pull request text, 1 in comments), 0 not readable', '']);
  assert.equal(lines.filter(line => /^Result: /.test(line)).length, 1, 'a file name writes no result line of its own');
  assert.ok(lines.slice(1, end).every(line => !/^\s*::/.test(line)), 'nor a workflow command');
  const text = fs.readFileSync(summary, 'utf8');
  assert.match(text, /^Toolkit personal data sweep: 6 found [^\n]*\n\n```text\n/);
  assert.match(text, /file docs\/notes\.md:2:5 {2}email {2}PDG-EMAIL/);
  assertNoEcho(assert, `${result.all}${text}`, value, 'log and summary');
});

test('what it cannot read is counted apart, and a file name with personal data is not shown', t => {
  const value = markerEmail();
  const repo = new TestRepo(t);
  repo.commit('start', { 'logo.png': PNG, [`${value}.md`]: 'clean\n' });
  const result = sweep(repo, fakeGh());
  assert.equal(result.status, 0, result.all);
  assert.match(result.out, /file logo\.png {2}unscannable {2}PDG-UNSCANNABLE/);
  assert.match(result.out, /file path #1 \(name withheld\):1:1 {2}email {2}PDG-EMAIL/);
  assert.match(result.out, /1 found \(1 in files, 0 in commit messages, 0 in pull request text, 0 in comments\), 1 not readable/);
  assertNoEcho(assert, result.all, value, 'path');
});

test('a sweep that cannot read everything says so and is never a clean report', t => {
  const value = markerEmail();
  const { repo } = planted(t, value);
  for (const [fail, what] of [['pulls?', 'pull requests'], ['issues/comments', 'issue and pull request comments'], ['pulls/comments', 'review comments']]) {
    const result = sweep(repo, fakeGh({ fail }));
    assert.equal(result.status, 2, fail);
    assert.equal(result.out, '', 'no report');
    assert.equal(result.err, `personal-data-guard: could not scan: ${what} could not be read from GitHub (gh exit 1)\nResult: COULD NOT SCAN (treated as a failure)\n`);
  }
  for (const raw of [`not json ${value}\n`, `["x", "${value}"`, '[1]\n', '[1,2,null]\n', '{"a":1}\n']) {
    const result = sweep(repo, fakeGh({ raw }));
    assert.equal(result.status, 2, raw);
    assert.match(result.err, /could not be understood/);
    assertNoEcho(assert, result.all, value, 'unreadable rows');
  }
  assert.equal(sweep(repo, fakeGh(), { args: [] }).status, 2, 'no repository named');
  assert.equal(sweep(repo, fakeGh(), { args: ['--github', `${value}/x`] }).status, 2, 'not a repository name');
  assertNoEcho(assert, sweep(repo, fakeGh(), { args: ['--github', `${value}/x`] }).all, value, 'repository name');
  // A shallow clone holds only some commits.
  const clone = path.join(repo.dir, 'shallow');
  repo.git(['clone', '-q', '--depth', '1', `file://${repo.root.replace(/\\/g, '/')}`, clone]);
  const shallow = sweep({ ...repo, root: clone, env: repo.env }, fakeGh());
  assert.equal(shallow.status, 2);
  assert.match(shallow.err, /this clone is shallow/);
});
