'use strict';

// Personal-data guard installer and git hooks, run through real git: the hooks land in the folder
// git actually uses, a hook that was already there keeps running, and real commits and pushes are
// blocked. The agent-side --no-verify refusal is tested with the attribution guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const installer = require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
const { BASE_CONFIG, TestRepo, assertNoEcho, markerEmail, pii } = require('./support/personal-data-fixtures.cjs');

const TEMPLATE = path.resolve(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'templates', 'github-actions', 'personal-data-guard.yml');

function head(repo) { return repo.git(['rev-parse', 'HEAD']); }

function commitThroughHooks(repo, args) { return repo.git(['commit', '-q', ...args], { allowFailure: true }); }

test('installer: default hooks folder; real commits and pushes are blocked; --no-verify shows why CI is needed', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  const result = repo.installer([]);
  assert.equal(result.status, 0, result.all);
  const hooks = fs.realpathSync(path.join(repo.root, '.git', 'hooks'));
  assert.match(result.all, /Hooks folder git uses: /);
  assert.equal(fs.realpathSync(result.all.match(/Hooks folder git uses: (.*)/)[1].trim()), hooks);
  for (const name of installer.HOOKS) assert.match(fs.readFileSync(path.join(hooks, name), 'utf8'), new RegExp(installer.HOOK_MARKER));

  const value = markerEmail();
  const before = head(repo);
  repo.write('contact.txt', `${value}\n`);
  repo.git(['add', 'contact.txt']);
  let commit = commitThroughHooks(repo, ['-m', 'add contact']);
  assert.notEqual(commit.status, 0, 'pre-commit blocks a staged hit');
  assert.match(commit.stderr, /contact\.txt:1:1 {2}email {2}PDG-EMAIL/);
  assertNoEcho(assert, `${commit.stdout}${commit.stderr}`, value, 'pre-commit hook');
  assert.equal(head(repo), before);
  repo.git(['reset', '-q', 'contact.txt']);
  fs.rmSync(path.join(repo.root, 'contact.txt'));

  repo.write('notes.txt', 'clean\n');
  repo.git(['add', 'notes.txt']);
  commit = commitThroughHooks(repo, ['-m', `note for ${value}`]);
  assert.notEqual(commit.status, 0, 'commit-msg blocks -m');
  assertNoEcho(assert, `${commit.stdout}${commit.stderr}`, value, 'commit-msg hook');
  const messageFile = repo.write('../message.txt', `Notes\n\nCall ${pii.sgPlus()}\n`);
  assert.notEqual(commitThroughHooks(repo, ['-F', messageFile]).status, 0, 'commit-msg blocks -F');
  assert.equal(commitThroughHooks(repo, ['-m', 'Add notes']).status, 0, 'a clean commit passes');
  assert.notEqual(commitThroughHooks(repo, ['--amend', '-m', `Add notes for ${value}`]).status, 0, 'commit-msg blocks an amend');

  const remote = new TestRepo(t, { config: null, bare: true });
  repo.git(['remote', 'add', 'origin', remote.root]);
  repo.git(['push', '-q', 'origin', 'main']);
  repo.commit('contact list', { 'list.txt': `${value}\n` });
  const push = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.notEqual(push.status, 0, 'pre-push blocks a commit made with --no-verify');
  assert.match(push.stderr, /commit [0-9a-f]{12} list\.txt:1:1 {2}email/);
  assertNoEcho(assert, `${push.stdout}${push.stderr}`, value, 'pre-push hook');
  // A person can still skip local hooks; that is why the CI job is the backstop.
  assert.equal(repo.git(['push', '-q', '--no-verify', 'origin', 'main'], { allowFailure: true }).status, 0);
});

test('pre-push: with the plain-text check installed too, a hand push of a changed file with a finding is blocked', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  assert.equal(repo.installer([]).status, 0);
  const plainInstaller = path.resolve(__dirname, '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'install-plain-text-check.cjs');
  const installed = require('node:child_process').spawnSync(process.execPath, [plainInstaller, '--repo', repo.root], { cwd: repo.root, env: repo.env, encoding: 'utf8', windowsHide: true });
  assert.equal(installed.status, 0, `${installed.stdout}${installed.stderr}`);
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '--no-verify', '-m', 'plain-text check']);
  const remote = new TestRepo(t, { config: null, bare: true });
  repo.git(['remote', 'add', 'origin', remote.root]);
  repo.git(['push', '-q', '-u', 'origin', 'main']);
  // Built from pieces so this file carries no reference itself.
  repo.commit('guide', { 'docs/guide.md': `See ${['#', '42'].join('')} for details.\n` });
  const push = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.notEqual(push.status, 0, 'pre-push blocks the plain-text finding');
  assert.match(push.stderr, /docs\/guide\.md:1: number-reference/);
  // A token inside a link is never printed: the item names the file, line and rule only.
  const token = ['gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0'].join('');
  repo.commit('links', { 'docs/links.md': `Issue: https://github.com/owner/repo/issues/12?access=${token}\nCompare: https://github.com/owner/repo/compare/main...${token}\n` });
  const leak = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.notEqual(leak.status, 0);
  assert.match(leak.stderr, /docs\/links\.md:1: github-link: /);
  for (let start = 0; start + 8 <= token.length; start += 4) assert.ok(!`${leak.stdout}${leak.stderr}`.includes(token.slice(start, start + 8)), 'no part of the token is printed');
  // A push that does not send the current commit is not checked here, with a note.
  repo.git(['branch', 'other', 'origin/main']);
  const other = repo.git(['push', '-q', 'origin', 'other'], { allowFailure: true });
  assert.equal(other.status, 0, other.stderr);
  assert.match(other.stderr, /plain-text check: skipped, because this push does not send the current commit/);
  repo.git(['reset', '-q', '--hard', 'HEAD~1']);
  // Deleting a remote branch that sits at the current commit sends nothing, so it is not checked.
  repo.git(['push', '-q', '--no-verify', 'origin', 'HEAD:refs/heads/at-head']);
  const removed = repo.git(['push', '-q', 'origin', '--delete', 'at-head'], { allowFailure: true });
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stderr, /plain-text check: skipped, because this push does not send the current commit/);
  // No upstream: the step compares with origin/main instead, and still blocks the finding.
  repo.git(['branch', '--unset-upstream']);
  const fallback = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.notEqual(fallback.status, 0);
  assert.match(fallback.stderr, /docs\/guide\.md:1: number-reference/);
  repo.git(['branch', '-u', 'origin/main']);
  // Uncommitted changes: the working folder is not what is pushed, so the step is skipped with a note.
  repo.write('docs/guide.md', 'Being rewritten.\n');
  const dirty = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.equal(dirty.status, 0, dirty.stderr);
  assert.match(dirty.stderr, /plain-text check: skipped, because the working folder has uncommitted changes/);
  repo.commit('plain guide', { 'docs/guide.md': 'See the install steps for details.\n' });
  const clean = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.equal(clean.status, 0, clean.stderr);
  // Broken settings: the check cannot run, so the push goes on with a note.
  repo.commit('broken settings', { '.github/plain-text.json': '{ not json\n' });
  const broken = repo.git(['push', '-q', 'origin', 'main'], { allowFailure: true });
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.stderr, /plain-text check: could not run, so the push goes on unchecked/);
  // Nothing to compare with: no upstream and no origin branch.
  repo.commit('more', { 'docs/more.md': 'More.\n' });
  repo.git(['branch', '--unset-upstream']);
  repo.git(['update-ref', '-d', 'refs/remotes/origin/main']);
  const nobase = repo.git(['push', '-q', remote.root, 'main'], { allowFailure: true });
  assert.equal(nobase.status, 0, nobase.stderr);
  assert.match(nobase.stderr, /plain-text check: skipped, because no upstream or origin branch was found/);
});

test('installer --check: a guard hook from an older template is reported as outdated', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  assert.equal(repo.installer([]).status, 0);
  assert.equal(repo.installer(['--check']).status, 0);
  const hook = path.join(repo.root, '.git', 'hooks', 'pre-push');
  fs.writeFileSync(hook, fs.readFileSync(hook, 'utf8').replace(/^plain=.*\n/m, ''));
  const check = repo.installer(['--check']);
  assert.equal(check.status, 1);
  assert.match(check.all, /Drift: hook pre-push: outdated/);
});

test('installer: core.hooksPath is followed, and the default folder is left alone', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  repo.git(['config', 'core.hooksPath', '.githooks']);
  const result = repo.installer([]);
  assert.equal(result.status, 0, result.all);
  for (const name of installer.HOOKS) {
    assert.match(fs.readFileSync(path.join(repo.root, '.githooks', name), 'utf8'), new RegExp(installer.HOOK_MARKER));
    assert.equal(fs.existsSync(path.join(repo.root, '.git', 'hooks', name)), false, `${name} not in .git/hooks`);
  }
  repo.write('contact.txt', `${pii.email()}\n`);
  repo.git(['add', 'contact.txt']);
  assert.notEqual(commitThroughHooks(repo, ['-m', 'add contact']).status, 0, 'the hook in core.hooksPath runs');
});

test('installer: an existing hook is kept, chained after the guard, and a rerun keeps it', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  const ran = path.join(repo.dir, 'foreign-ran');
  const foreign = path.join(repo.root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(foreign, `#!/bin/sh\necho ran > "${ran.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
  let result = repo.installer([]);
  assert.equal(result.status, 0, result.all);
  assert.match(result.all, /Hook installed: pre-commit \(the earlier hook runs after it\)/);
  result = repo.installer([]);
  assert.equal(result.status, 0, result.all);
  assert.match(fs.readFileSync(`${foreign}.pre-personal-data-guard`, 'utf8'), /echo ran/);

  repo.write('notes.txt', 'clean\n');
  repo.git(['add', 'notes.txt']);
  assert.equal(commitThroughHooks(repo, ['-m', 'Add notes']).status, 0);
  assert.equal(fs.existsSync(ran), true, 'the earlier hook ran after the guard');
  fs.rmSync(ran);
  repo.write('contact.txt', `${pii.email()}\n`);
  repo.git(['add', 'contact.txt']);
  assert.notEqual(commitThroughHooks(repo, ['-m', 'add contact']).status, 0);
  assert.equal(fs.existsSync(ran), false, 'a blocked commit does not reach the earlier hook');

  // A different saved hook and a different live one: nothing is overwritten.
  fs.writeFileSync(foreign, '#!/bin/sh\nexit 0\n');
  result = repo.installer([]);
  assert.equal(result.status, 2);
  assert.match(result.all, /nothing was overwritten/);
});

test('installer: reports plainly when it cannot install', (t) => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-norepo-'));
  t.after(() => fs.rmSync(notRepo, { recursive: true, force: true }));
  let out = '';
  let status = installer.main(['--repo', notRepo], { out: { write: (text) => { out += text; } }, err: { write: (text) => { out += text; } } });
  assert.equal(status, 2);
  assert.match(out, /not inside a git working tree, so nothing was installed/);

  const blocked = new TestRepo(t);
  blocked.write('hooks-file', 'not a folder\n');
  blocked.git(['config', 'core.hooksPath', 'hooks-file']);
  let result = blocked.installer([]);
  assert.equal(result.status, 2);
  assert.match(result.all, /could not be created .* so nothing was installed/);
  assert.equal(fs.existsSync(path.join(blocked.root, '.github', 'scripts')), false);

  const fresh = new TestRepo(t, { config: null });
  result = fresh.installer([]);
  assert.equal(result.status, 2);
  assert.match(result.all, /pass --identity excluded or --identity included/);
  assert.equal(fs.existsSync(path.join(fresh.root, '.git', 'hooks', 'pre-commit')), false);
  result = fresh.installer(['--identity', 'excluded']);
  assert.equal(result.status, 2, 'excluded needs a reason');
  result = fresh.installer(['--identity', 'excluded', '--identity-reason', 'maintainer identities are public', '--workflow']);
  assert.equal(result.status, 0, result.all);
  const config = JSON.parse(fs.readFileSync(path.join(fresh.root, '.github', 'personal-data-guard.json'), 'utf8'));
  assert.equal(config.identity, 'excluded');
  assert.equal(config.required_check, 'none');
  assert.equal(fs.readFileSync(path.join(fresh.root, '.github', 'workflows', 'personal-data-guard.yml'), 'utf8'), fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n'));
  out = '';
  status = installer.main(['--repo', fresh.root, '--check'], { out: { write: (text) => { out += text; } }, err: { write: () => {} } });
  assert.equal(status, 0, out);
});

test('installer --check: a hand-edited or outdated guard copy and missing hooks are drift', (t) => {
  const repo = new TestRepo(t, { config: BASE_CONFIG });
  assert.equal(repo.installer([]).status, 0);
  const copy = path.join(repo.root, '.github', 'scripts', 'personal-data-guard.cjs');
  fs.appendFileSync(copy, '// local change\n');
  let result = repo.installer(['--check']);
  assert.equal(result.status, 1);
  assert.match(result.all, /guard copy .*: edited/);
  fs.rmSync(path.join(repo.root, '.git', 'hooks', 'pre-push'));
  result = repo.installer(['--check']);
  assert.match(result.all, /hook pre-push: missing/);

  const older = '#!/usr/bin/env node\n// older guard\n';
  assert.equal(installer.vendoredState(installer.vendoredText(older)).state, 'outdated');
  assert.equal(installer.vendoredState(installer.vendoredText()).state, 'current');
  assert.equal(installer.vendoredState('#!/usr/bin/env node\n').state, 'unmanaged');
  assert.equal(installer.vendoredState(null).state, 'missing');
});

test('the CI template checks pull requests and every branch push without interpolating event text', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(text, /pull_request:/);
  assert.match(text, /branches: \['\*\*'\]/);
  assert.match(text, /fetch-depth: 0/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /contents: read/);
  // A pull request's newer run cancels its older one; push runs are keyed on the run id so none is cancelled.
  assert.match(text, /^  group: personal-data-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}$/m);
  assert.match(text, /types: \[opened, edited, reopened, synchronize\]/);
  assert.match(text, /node \.github\/scripts\/personal-data-guard\.cjs ci/);
  assert.doesNotMatch(text, /\$\{\{\s*github\.event\./, 'event text is read from the event file, never interpolated');
  for (const use of text.match(/uses: \S+/g)) assert.match(use, /@[0-9a-f]{40}$/, `${use} is pinned to a commit`);
});
