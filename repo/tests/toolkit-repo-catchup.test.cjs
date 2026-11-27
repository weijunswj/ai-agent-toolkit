'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The session-start catch-up of the local default branch (toolkit-repo-catchup.cjs) on real
// temporary repositories: a bare origin, a seed that pushes to it and the clone a session starts in.
// The fresh read is injected (the session start's refresh), so nothing reaches the network.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const catchup = require('../scripts/toolkit-repo-catchup.cjs');
const bindingCache = require('../scripts/toolkit-governance-binding.cjs');
const launcher = require('../scripts/toolkit-codex-session-start.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');
const { seedMerged } = require('./support/governance-observations.cjs');

// The fixtures' git (and the catch-up's, which inherits this environment) reads no global or system
// config, so a Git LFS install or hook template on the test computer changes nothing.
const EMPTY_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-repo-catchup-config-')), 'gitconfig');
fs.writeFileSync(EMPTY_CONFIG, '');
process.env.GIT_CONFIG_GLOBAL = EMPTY_CONFIG;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const REMOTE = 'https://github.com/example-owner/example-repo.git';
const ID = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false'];

function git(cwd, args, options = {}) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options }).trim();
}

function commitFile(repo, file, text, message = `edit ${file}`) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, ['add', '--', file]);
  git(repo, [...ID, 'commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

// { root, origin, seed, clone, control, read(), behind(n) }: the clone is on main tracking origin/main.
// behind(n) pushes n commits from the seed and fetches them into the clone's origin/main, as the
// session start's refresh does; read() is that refresh's fresh result.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-repo-catchup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const clone = path.join(root, 'clone');
  const control = path.join(root, 'home', '.ai-agent-toolkit');
  childProcess.execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin], { windowsHide: true });
  childProcess.execFileSync('git', ['init', '--quiet', '--initial-branch=main', seed], { windowsHide: true });
  commitFile(seed, 'README.md', 'one\n', 'first');
  git(seed, ['push', '--quiet', origin, 'main']);
  childProcess.execFileSync('git', ['clone', '--quiet', origin, clone], { windowsHide: true });
  let pushed = 0;
  const behind = (count, files = []) => {
    for (let index = 0; index < count; index += 1) {
      pushed += 1;
      const file = files[index] || `file-${pushed}.txt`;
      commitFile(seed, file, `change ${pushed}\n`);
    }
    git(seed, ['push', '--quiet', origin, 'main']);
    // As the session start's refresh does: only origin's default branch, into its tracking ref.
    git(clone, ['fetch', '--quiet', origin, '+refs/heads/main:refs/remotes/origin/main']);
    return git(origin, ['rev-parse', 'main']);
  };
  const read = (at = clone) => ({ refreshed: true, error: null, root: at, default_branch: 'main', commit: git(origin, ['rev-parse', 'main']) });
  return { root, origin, seed, clone, control, behind, read };
}

// Runs git for real and records every call's arguments.
function recorder() {
  const calls = [];
  const runGit = (args, options) => { calls.push(args); TIMEOUTS.set(args, options.timeout); return bindingCache.defaultRunGit(args, options); };
  return { calls, runGit };
}

const ALL_CALLS = [];
// Each call's timeout: reads are bounded, the move never is.
const TIMEOUTS = new Map();
function run(f, read = f.read(), extra = {}) {
  const spy = recorder();
  const line = catchup.catchUp(read, { runGit: spy.runGit, controlRoot: f.control, environment: { ...process.env }, ...extra });
  ALL_CALLS.push(...spy.calls);
  return { line, calls: spy.calls };
}

const head = repo => git(repo, ['rev-parse', 'HEAD']);
// The reason, then its one step as a sentence of its own.
const NOT_MOVED = /^Toolkit: local main is (\d+) commits? behind origin\/main and was not moved: (.+?)\. (?:With the user's yes, |The agent |The next session start )[^]*\.$/;

test('1: a clean default branch that is behind is fast-forwarded to the fetched commit', t => {
  const f = fixture(t);
  const before = head(f.clone);
  const target = f.behind(3);
  const { line } = run(f);
  assert.equal(head(f.clone), target);
  assert.equal(line, `Toolkit: brought local main up to date with origin/main (${before.slice(0, 7)} to ${target.slice(0, 7)}, 3 commits).`);
  assert.equal(git(f.clone, ['status', '--porcelain']), '');
  assert.match(git(f.clone, ['status', '-sb']), /^## main\.\.\.origin\/main$/m);
  assert.match(git(f.clone, ['reflog', '-1', '--format=%gs']), /Fast-forward/);
  // Once up to date, the next start says nothing and changes nothing.
  assert.equal(run(f).line, null);
  assert.equal(head(f.clone), target);
});

test('2 and 3: uncommitted changes, tracked or untracked, keep the checkout where it is, with one line', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(2);
  for (const [label, dirty, clean] of [
    ['tracked', () => fs.writeFileSync(path.join(f.clone, 'README.md'), 'local edit\n'), () => fs.writeFileSync(path.join(f.clone, 'README.md'), 'one\n')],
    ['untracked', () => fs.writeFileSync(path.join(f.clone, 'note.txt'), 'x\n'), () => fs.rmSync(path.join(f.clone, 'note.txt'))],
  ]) {
    dirty();
    const { line } = run(f);
    assert.equal(head(f.clone), before, label);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['2', 'uncommitted changes'], label);
    clean();
  }
  // An ignored file is not a change.
  fs.writeFileSync(path.join(f.clone, '.git', 'info', 'exclude'), 'ignored.log\n');
  fs.writeFileSync(path.join(f.clone, 'ignored.log'), 'x\n');
  const target = f.behind(1);
  assert.match(run(f).line, /^Toolkit: brought local main up to date with origin\/main \([0-9a-f]{7} to [0-9a-f]{7}, 3 commits\)\.$/);
  assert.equal(head(f.clone), target);
});

test('4 and 5: another branch or a detached HEAD is never moved, and prints nothing', t => {
  const f = fixture(t);
  const main = head(f.clone);
  f.behind(2);
  git(f.clone, ['switch', '--quiet', '-c', 'feature']);
  assert.equal(run(f).line, null);
  assert.equal(git(f.clone, ['rev-parse', 'refs/heads/main']), main);
  assert.equal(git(f.clone, ['symbolic-ref', 'HEAD']), 'refs/heads/feature');
  git(f.clone, ['switch', '--quiet', '--detach', 'main']);
  assert.equal(run(f).line, null);
  assert.equal(head(f.clone), main);
  assert.equal(git(f.clone, ['rev-parse', 'refs/heads/main']), main);
});

test('6 and 7: only the session\'s own worktree moves, and only when it has the default branch', t => {
  const f = fixture(t);
  const main = head(f.clone);
  const target = f.behind(2);
  const linked = path.join(f.root, 'linked');
  // 6: main in the main worktree, the session in a linked worktree on a feature branch.
  git(f.clone, ['worktree', 'add', '--quiet', '-b', 'feature', linked]);
  assert.equal(run(f, f.read(linked)).line, null);
  assert.equal(head(f.clone), main);
  assert.equal(head(linked), main);
  // 7: the session in a linked worktree that has main; the main worktree is on another branch.
  git(f.clone, ['switch', '--quiet', '-c', 'elsewhere']);
  git(linked, ['switch', '--quiet', 'main']);
  const { line } = run(f, f.read(linked));
  assert.match(line, /^Toolkit: brought local main up to date/);
  assert.equal(head(linked), target);
  assert.equal(git(f.clone, ['symbolic-ref', 'HEAD']), 'refs/heads/elsewhere');
  assert.equal(head(f.clone), main, 'the main worktree keeps its own branch and files');
  assert.equal(git(f.clone, ['status', '--porcelain']), '');
});

test('8: no upstream, or an upstream that is not origin/<default>, is not moved, with one line', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(1);
  for (const [label, setup, undo] of [
    ['no upstream', () => git(f.clone, ['branch', '--unset-upstream']), () => git(f.clone, ['branch', '--quiet', '--set-upstream-to=origin/main'])],
    ['another remote', () => { git(f.clone, ['remote', 'add', 'fork', f.origin]); git(f.clone, ['config', 'branch.main.remote', 'fork']); }, () => git(f.clone, ['config', 'branch.main.remote', 'origin'])],
    ['another branch', () => git(f.clone, ['config', 'branch.main.merge', 'refs/heads/release']), () => git(f.clone, ['config', 'branch.main.merge', 'refs/heads/main'])],
  ]) {
    setup();
    const { line } = run(f);
    assert.equal(head(f.clone), before, label);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['1', 'its upstream is not origin/main'], label);
    undo();
  }
  assert.match(run(f).line, /^Toolkit: brought/, 'tracking origin/main again, it moves');
});

test('9 and 10: a diverged branch keeps its commits and reflog; a branch only ahead prints nothing', t => {
  const f = fixture(t);
  f.behind(2);
  const local = commitFile(f.clone, 'mine.txt', 'local\n', 'local work');
  const reflog = git(f.clone, ['reflog', '--format=%H %gs']);
  const { line } = run(f);
  assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['2', 'it has local commits that are not on origin']);
  assert.equal(head(f.clone), local);
  assert.equal(git(f.clone, ['reflog', '--format=%H %gs']), reflog);
  const ahead = fixture(t);
  const mine = commitFile(ahead.clone, 'mine.txt', 'local\n', 'local work');
  assert.equal(run(ahead).line, null);
  assert.equal(head(ahead.clone), mine);
});

test('11: a merge, rebase, cherry-pick, revert or bisect in progress keeps the checkout, with one line', t => {
  const f = fixture(t);
  f.behind(1);
  git(f.clone, ['switch', '--quiet', '-c', 'side']);
  commitFile(f.clone, 'side.txt', 'side\n');
  git(f.clone, ['switch', '--quiet', 'main']);
  const before = head(f.clone);
  const IN_PROGRESS_LINE = ['1', 'a merge, rebase, cherry-pick, revert or bisect is in progress'];
  for (const marker of catchup.IN_PROGRESS) {
    const file = path.join(f.clone, '.git', marker);
    if (marker.startsWith('rebase-')) fs.mkdirSync(file);
    else fs.writeFileSync(file, `${before}\n`);
    const { line } = run(f);
    assert.equal(head(f.clone), before, marker);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), IN_PROGRESS_LINE, marker);
    fs.rmSync(file, { recursive: true });
  }
  // A real merge left open (MERGE_HEAD written by git itself).
  git(f.clone, [...ID, 'merge', '--no-ff', '--no-commit', 'side']);
  const { line } = run(f);
  assert.equal(head(f.clone), before);
  assert.deepEqual(NOT_MOVED.exec(line).slice(1), IN_PROGRESS_LINE);
});

test('12, 13 and 14: a failed, killed or cached read moves nothing and runs no git at all', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(2);
  const sentinel = path.join(f.root, 'askpass-ran');
  const askpass = path.join(f.root, process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh');
  fs.writeFileSync(askpass, process.platform === 'win32' ? `@echo off\r\necho x> "${sentinel}"\r\n` : `#!/bin/sh\necho x > "${sentinel}"\n`, { mode: 0o755 });
  const environment = { ...process.env, GIT_ASKPASS: askpass, SSH_ASKPASS: askpass };
  for (const read of [
    { refreshed: false, error: 'remote-unreachable' }, // an auth prompt the refresh refused
    { refreshed: false, error: 'fetch-failed' }, // the fetch stopped at its timeout
    { refreshed: false, error: 'offline' }, // only the cached read
    { refreshed: false, error: 'remote-redirected' },
    null, {},
    { refreshed: true, root: f.clone, default_branch: 'main' }, // no commit
    { refreshed: true, root: 'relative', default_branch: 'main', commit: 'a'.repeat(40) },
    { refreshed: true, root: f.clone, default_branch: '-c', commit: 'a'.repeat(40) },
  ]) {
    const started = Date.now();
    const { line, calls } = run(f, read, { environment });
    assert.equal(line, null, JSON.stringify(read));
    assert.deepEqual(calls, [], 'no git call');
    assert.ok(Date.now() - started < 1000, 'no wait added');
  }
  assert.equal(head(f.clone), before);
  // A move runs no prompt helper either: the catch-up reads nothing from the network.
  assert.match(run(f, f.read(), { environment }).line, /^Toolkit: brought/);
  assert.equal(fs.existsSync(sentinel), false, 'the askpass sentinel never ran');
});

test('15: a repository with a merge or checkout hook is never moved, and its hook never runs', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(1);
  const sentinel = path.join(f.root, 'hook-ran');
  const ownHooks = path.join(f.root, 'own-hooks');
  const cases = [
    ...catchup.MOVE_HOOKS.map(hook => ['.git/hooks', path.join(f.clone, '.git', 'hooks'), hook]),
    ['core.hooksPath', ownHooks, 'post-merge'],
  ];
  for (const [where, folder, hook] of cases) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, hook), `#!/bin/sh\necho x > "${sentinel.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    if (where === 'core.hooksPath') git(f.clone, ['config', 'core.hooksPath', folder.replace(/\\/g, '/')]);
    const { line } = run(f);
    assert.equal(head(f.clone), before, `${hook} in ${where}`);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['1', 'the repository has merge or checkout hooks, which Toolkit does not run'], `${hook} in ${where}`);
    assert.equal(fs.existsSync(sentinel), false, `${hook} in ${where} did not run`);
    fs.rmSync(path.join(folder, hook));
  }
  // Sample hooks git ships are not hooks; with only those, it moves.
  git(f.clone, ['config', '--unset', 'core.hooksPath']);
  fs.writeFileSync(path.join(f.clone, '.git', 'hooks', 'post-merge.sample'), '#!/bin/sh\n');
  const target = f.behind(1);
  assert.match(run(f).line, /^Toolkit: brought/);
  assert.equal(head(f.clone), target);
});

test('16: a move that changes a file with a filter attribute (Git LFS) is not made', t => {
  const LFS = '*.bin filter=lfs diff=lfs merge=lfs -text\n';
  for (const [label, attributesFirst] of [['the attribute arrives with the move', false], ['the attribute is already in the checkout', true]]) {
    const f = fixture(t);
    commitFile(f.seed, '.gitattributes', LFS);
    if (attributesFirst) {
      git(f.seed, ['push', '--quiet', f.origin, 'main']);
      git(f.clone, ['pull', '--quiet', '--ff-only']);
    }
    commitFile(f.seed, 'big.bin', 'binary\n');
    git(f.seed, ['push', '--quiet', f.origin, 'main']);
    git(f.clone, ['fetch', '--quiet', 'origin']);
    const before = head(f.clone);
    const { line } = run(f);
    assert.equal(head(f.clone), before, label);
    assert.match(line, /was not moved: files the move changes use a filter such as Git LFS\. With the user's yes, the agent pulls it by hand\.$/, label);
  }
});

test('17: Toolkit\'s own checkouts are never moved by the catch-up, and print nothing', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(1);
  // The managed checkout the bridge records.
  const state = path.join(f.control, 'current', 'state.json');
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, JSON.stringify({ repo_path: f.clone }));
  assert.deepEqual(run(f), { line: null, calls: [] });
  fs.rmSync(state);
  // The running plugin root.
  assert.deepEqual(run(f, f.read(), { pluginRoot: f.clone }), { line: null, calls: [] });
  assert.equal(head(f.clone), before);
  // Anything under ~/.ai-agent-toolkit.
  const nested = path.join(f.control, 'source', 'ai-agent-toolkit');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.renameSync(f.clone, nested);
  assert.deepEqual(run(f, f.read(nested)), { line: null, calls: [] });
  assert.equal(head(nested), before);
});

// The Claude Code governance hook's session start, with this start's read injected.
function hookStart(f, registryOptions, input, { cloud = false } = {}) {
  const spy = recorder();
  const repoCatchUp = { catchUp: (fresh, options) => catchup.catchUp(fresh, { ...options, runGit: spy.runGit, controlRoot: f.control }) };
  const home = path.join(f.root, 'home');
  // The hook runs with the host's whole environment (PATH included, which finds git on Windows).
  const environment = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_REMOTE: cloud ? 'true' : '' };
  const output = claudeHook.respond('SessionStart', { session_id: 's1', ...input }, { registryOptions, environment, refreshBinding: () => f.read(input.cwd), repoCatchUp });
  ALL_CALLS.push(...spy.calls);
  return { context: output.hookSpecificOutput ? output.hookSpecificOutput.additionalContext : '', calls: spy.calls };
}

// A test registry in the fixture's own home (the governance gate's scratch layout).
function registryOf(f, name = 'home') {
  const home = path.join(f.root, name);
  return { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true, home, userHome: home };
}

test('18: a compacted or cleared session, and a cloud session, run no catch-up git call', t => {
  const f = fixture(t);
  const before = head(f.clone);
  f.behind(1);
  git(f.clone, ['remote', 'set-url', 'origin', REMOTE]);
  for (const source of ['compact', 'clear']) {
    const { context, calls } = hookStart(f, registryOf(f), { cwd: f.clone, source });
    assert.deepEqual(calls, [], source);
    assert.doesNotMatch(context, /Toolkit: (brought|local main)/, source);
  }
  const cloud = hookStart(f, registryOf(f), { cwd: f.clone, source: 'startup' }, { cloud: true });
  assert.deepEqual(cloud.calls, []);
  assert.doesNotMatch(cloud.context, /Toolkit: (brought|local main)/);
  assert.equal(head(f.clone), before);
});

test('19: governance enabled, disabled or not decided gives the same catch-up, before the governance line', t => {
  const f = fixture(t);
  git(f.clone, ['remote', 'set-url', 'origin', REMOTE]);
  const lines = [];
  for (const decision of ['enable', 'disable', null]) {
    const before = head(f.clone);
    const target = f.behind(2);
    const registryOptions = registryOf(f, decision || 'undecided');
    if (decision) seedMerged(f.clone, decision, { registryOptions });
    for (const source of ['startup', 'resume']) {
      const { context } = hookStart(f, registryOptions, { cwd: f.clone, source });
      const [first, ...rest] = context.split('\n');
      if (source === 'startup') {
        assert.equal(first, `Toolkit: brought local main up to date with origin/main (${before.slice(0, 7)} to ${target.slice(0, 7)}, 2 commits).`, String(decision));
        assert.match(rest.join('\n'), decision === 'enable' ? /Toolkit governance: ENABLED/ : /\S/, 'the governance line follows');
        lines.push(first.replace(/[0-9a-f]{7} to [0-9a-f]{7}/, 'X to Y'));
      } else assert.doesNotMatch(context, /Toolkit: (brought|local main)/, 'nothing new on resume');
    }
    assert.equal(head(f.clone), target, String(decision));
  }
  assert.equal(new Set(lines).size, 1);
});

test('20: a move that changes AGENTS.md, CLAUDE.md or a file CLAUDE.md imports asks the session to read them again', t => {
  const REREAD = ' AGENTS.md or CLAUDE.md changed; read them again before acting.';
  const f = fixture(t);
  for (const [label, files, expected] of [
    ['AGENTS.md', ['AGENTS.md'], true],
    ['nested CLAUDE.md', ['docs/CLAUDE.md'], true],
    ['an ordinary file', ['src/app.txt'], false],
  ]) {
    f.behind(1, files);
    assert.equal(run(f).line.endsWith(REREAD), expected, label);
  }
  // A file the root CLAUDE.md imports.
  commitFile(f.seed, 'CLAUDE.md', '# Rules\n\n@docs/agent-rules.md\n');
  f.behind(0);
  assert.ok(run(f).line.endsWith(REREAD), 'CLAUDE.md itself');
  f.behind(1, ['docs/agent-rules.md']);
  assert.ok(run(f).line.endsWith(REREAD), 'an imported file');
  f.behind(1, ['docs/other.md']);
  assert.ok(!run(f).line.endsWith(REREAD), 'a file it does not import');
});
// A setup whose pull request holds files it also wrote into the checkout (an older governance turn-on):
// origin gains the files in one commit while the clone keeps the same bytes untracked.
const LEFTOVERS = Object.freeze({
  '.github/plain-text.json': '{\n  "schema": "fixture"\n}\n',
  '.github/scripts/plain-text-check.cjs': '#!/usr/bin/env node\nconsole.log("fixture");\n',
  '.github/dependabot.yml': 'version: 2\nupdates: []\n',
});
function setupLeftovers(f, files = LEFTOVERS) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(f.seed, file)), { recursive: true });
    fs.writeFileSync(path.join(f.seed, file), text);
    git(f.seed, ['add', '--', file]);
  }
  git(f.seed, [...ID, 'commit', '--quiet', '-m', 'governance setup']);
  git(f.seed, ['push', '--quiet', f.origin, 'main']);
  git(f.clone, ['fetch', '--quiet', f.origin, '+refs/heads/main:refs/remotes/origin/main']);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(f.clone, file)), { recursive: true });
    fs.writeFileSync(path.join(f.clone, file), text);
  }
  return git(f.origin, ['rev-parse', 'main']);
}
const bytesOf = (root, files) => Object.fromEntries(Object.keys(files).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));

test('24: untracked files the move adds with the same bytes are cleared and the checkout moves', t => {
  const f = fixture(t);
  const before = head(f.clone);
  const target = setupLeftovers(f);
  const { line } = run(f);
  assert.equal(head(f.clone), target);
  assert.equal(line, `Toolkit: brought local main up to date with origin/main (${before.slice(0, 7)} to ${target.slice(0, 7)}, 1 commit). Untracked copies of 3 files it adds, identical to the merged ones, were replaced by the tracked files: ${Object.keys(LEFTOVERS).sort().join(', ')}.`);
  assert.equal(git(f.clone, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.deepEqual(bytesOf(f.clone, LEFTOVERS), LEFTOVERS);
});

test('25: one differing or one extra untracked file keeps the checkout, and every file stays as it was', t => {
  for (const [label, change] of [
    ['differs', clone => fs.writeFileSync(path.join(clone, '.github', 'plain-text.json'), '{ "local": true }\n')],
    ['extra', clone => fs.writeFileSync(path.join(clone, '.github', 'notes.md'), 'mine\n')],
    ['tracked edit', clone => fs.writeFileSync(path.join(clone, 'README.md'), 'local edit\n')],
  ]) {
    const f = fixture(t);
    const before = head(f.clone);
    setupLeftovers(f);
    change(f.clone);
    const kept = Object.fromEntries(git(f.clone, ['ls-files', '--others', '--exclude-standard']).split('\n').map(file => [file, fs.readFileSync(path.join(f.clone, file), 'utf8')]));
    const { line } = run(f);
    assert.equal(head(f.clone), before, label);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['1', 'uncommitted changes'], label);
    for (const [file, text] of Object.entries(kept)) assert.equal(fs.readFileSync(path.join(f.clone, file), 'utf8'), text, `${label}: ${file}`);
  }
});

test('26: an untracked file the move does not add keeps the checkout, even with the bytes of a tracked file', t => {
  const f = fixture(t);
  const before = head(f.clone);
  // The same bytes as a file already in the clone's commit: the move does not add it, so it is not a leftover.
  fs.writeFileSync(path.join(f.clone, 'copy-of-readme.md'), 'one\n');
  f.behind(1);
  assert.deepEqual(NOT_MOVED.exec(run(f).line).slice(1), ['1', 'uncommitted changes']);
  assert.equal(head(f.clone), before);
  assert.equal(fs.readFileSync(path.join(f.clone, 'copy-of-readme.md'), 'utf8'), 'one\n');
});

test('27: a move that fails after the leftovers were cleared puts them back exactly', t => {
  const f = fixture(t);
  const before = head(f.clone);
  setupLeftovers(f);
  const spy = recorder();
  const failing = (args, options) => args.includes('merge') && args.includes('--ff-only') ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } : spy.runGit(args, options);
  const line = catchup.catchUp(f.read(), { runGit: failing, controlRoot: f.control, environment: { ...process.env } });
  ALL_CALLS.push(...spy.calls);
  assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['1', 'git was busy or the move failed']);
  assert.equal(head(f.clone), before);
  assert.deepEqual(bytesOf(f.clone, LEFTOVERS), LEFTOVERS);
});

test('28: a leftover changed after the comparison is never removed, and the ones already cleared are put back', t => {
  // Each file in turn is edited between the comparison and the removal (the changed-files read comes
  // after the comparison), so the files cleared before it are restored too.
  for (const edited of Object.keys(LEFTOVERS)) {
    const f = fixture(t);
    const before = head(f.clone);
    setupLeftovers(f);
    const spy = recorder();
    const late = (args, options) => {
      if (args.includes('diff') && args.includes('--name-only')) fs.writeFileSync(path.join(f.clone, edited), 'changed after the comparison\n');
      return spy.runGit(args, options);
    };
    const line = catchup.catchUp(f.read(), { runGit: late, controlRoot: f.control, environment: { ...process.env } });
    ALL_CALLS.push(...spy.calls);
    assert.deepEqual(NOT_MOVED.exec(line).slice(1), ['1', 'uncommitted changes'], edited);
    assert.equal(head(f.clone), before, edited);
    assert.deepEqual(bytesOf(f.clone, LEFTOVERS), { ...LEFTOVERS, [edited]: 'changed after the comparison\n' }, edited);
  }
});

// Runs after every row above: the catch-up only ever ran the allowed read verbs and one fast-forward.
test('21: every git call the catch-up made used only the allowed verbs, and never a moving or forcing one', () => {
  assert.ok(ALL_CALLS.length > 50, 'the rows above made real calls');
  const verbs = new Set();
  for (const args of ALL_CALLS) {
    let index = 0;
    while (index < args.length && args[index].startsWith('-')) index += args[index] === '-c' ? 2 : 1;
    const verb = args[index];
    verbs.add(verb);
    assert.ok(catchup.ALLOWED_VERBS.includes(verb), `allowed verb: ${args.join(' ')}`);
    assert.doesNotMatch(args.join(' '), /(^| )(reset|checkout|switch|stash|rebase|pull|push|update-ref|branch|clean|fetch)( |$)|--force|(^| )-f( |$)/, args.join(' '));
    if (verb === 'merge') assert.deepEqual(args.slice(2, 6), ['merge', '--ff-only', '--no-stat', '--quiet'], 'the only write is a fast-forward with hooks off');
    if (verb === 'merge') assert.match(args[1], /^core\.hooksPath=.+toolkit-catchup-hooks-/);
    assert.equal(TIMEOUTS.get(args), verb === 'merge' ? undefined : 5000, `timeout: ${args.join(' ')}`);
    if (verb === 'config') assert.equal(args[1], '--get');
  }
  assert.ok(verbs.has('merge'), 'the rows include real moves');
  assert.deepEqual([...catchup.ALLOWED_VERBS].sort(), ['cat-file', 'check-attr', 'config', 'diff', 'merge', 'merge-base', 'rev-list', 'rev-parse', 'status', 'symbolic-ref']);
  assert.ok(verbs.has('cat-file'), 'the rows include a leftover comparison');
});

test('22: the Codex session start hands the catch-up line to the governance text, which leads with it, and a throwing catch-up drops only its line', () => {
  const read = { refreshed: true, root: '/r', default_branch: 'main', commit: 'b'.repeat(40) };
  const seen = [];
  // As the real governance text does outside a held block: the catch-up line first, on its own line.
  const gate = {
    startSession(input, options) { seen.push(options.host); options.onRefresh(read); return 'mark'; },
    sessionLine: (_cwd, given) => [given.localCopy, 'Toolkit governance: off here.'].filter(Boolean).join('\n'),
    sessionIdOf: input => input.session_id,
  };
  const bridge = { run: () => ({ status: 0 }) };
  const output = dependencies => {
    const lines = [];
    const original = console.log;
    console.log = line => lines.push(String(line));
    try { assert.equal(launcher.main(launcher.HOOK_ARGS, { bridge, gate, input: { cwd: '/r', session_id: 's1', source: 'startup' }, ...dependencies }), 0); } finally { console.log = original; }
    return lines;
  };
  const passed = [];
  assert.deepEqual(output({ catchUp: { catchUp: fresh => { passed.push(fresh); return 'Toolkit: brought local main up to date.'; } } }), ['Toolkit: brought local main up to date.\nToolkit governance: off here.']);
  assert.deepEqual(passed, [read], 'the catch-up gets this start\'s fresh read');
  assert.deepEqual(seen, ['codex']);
  assert.deepEqual(output({ catchUp: { catchUp() { throw new Error('boom'); } } }), ['Toolkit governance: off here.']);
  assert.deepEqual(output({ catchUp: { catchUp: () => null } }), ['Toolkit governance: off here.']);
});

test('23: the binding read and the catch-up run git from its PATH location, never a git.exe in the repository', t => {
  // Unit: the command spawned is what resolvePathExecutable gives (the PATH git.exe on Windows).
  const spawned = [];
  const spawn = (command, args, options) => { spawned.push({ command, args, env: options.env }); return { status: 0, stdout: Buffer.from('ok'), stderr: Buffer.alloc(0) }; };
  const result = bindingCache.defaultRunGit(['rev-parse', 'HEAD'], { cwd: os.tmpdir(), timeout: 1000, spawn });
  assert.equal(result.status, 0);
  assert.equal(spawned.length, 1);
  const expected = require('../scripts/claude-process-launch.cjs').resolvePathExecutable('git');
  assert.equal(spawned[0].command, expected);
  if (process.platform === 'win32') assert.ok(path.isAbsolute(spawned[0].command) && /git\.exe$/i.test(spawned[0].command));
  assert.equal(spawned[0].env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(spawned[0].env.GIT_ASKPASS, '');
  // Real: a git.exe planted in the repository (a copy of node that runs a script named like git's
  // first argument) never runs, for the binding read's runner or for a catch-up move.
  const f = fixture(t);
  f.behind(1);
  const sentinel = path.join(f.root, 'planted-git-ran');
  const planted = `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran');\n`;
  fs.copyFileSync(process.execPath, path.join(f.clone, 'git.exe'));
  for (const verb of ['ls-remote', 'symbolic-ref', 'rev-parse']) fs.writeFileSync(path.join(f.clone, verb), planted);
  fs.writeFileSync(path.join(f.clone, '.git', 'info', 'exclude'), 'git.exe\nls-remote\nsymbolic-ref\nrev-parse\n');
  assert.equal(bindingCache.defaultRunGit(['ls-remote', '--get-url', 'origin'], { cwd: f.clone, timeout: 5000 }).status, 0);
  assert.match(run(f).line, /^Toolkit: brought/);
  assert.equal(fs.existsSync(sentinel), false, 'the planted git.exe never ran');
});
