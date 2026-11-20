'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// Automatic updates on a computer: always on once a managed checkout is recorded, a session start
// with nothing new does no fetch or validation, a session whose start moved the checkout gets one
// notice, and readers wait while git moves the checkout. Every case uses a temporary home, Claude
// config folder, hub and git remote.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { changesBetween, updateNotice, MAX_CHANGES } = require('../scripts/toolkit-update-notice.cjs');
const marker = require('../scripts/toolkit-update-marker.cjs');
const {
  repoRoot, script, NOTICE, tmpRoot, writeJson, readJson, git, installToolkit, staleManagedCheckout, recordCheckout, hook, validations,
} = require('./support/toolkit-auto-update-fixture.cjs');

test('an update gives one notice; a session start with nothing new does no fetch or validation and stays silent', (t) => {
  const root = tmpRoot(t);
  const { origin, seed, managed, upstream } = staleManagedCheckout(root);
  installToolkit(root, managed);
  const hub = recordCheckout(root, managed, origin);
  const log = path.join(root, 'validations.log');
  const run = () => hook(root, hub, managed, { bridge: path.join(managed, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), extra: { TOOLKIT_TEST_VALIDATION_LOG: log } });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), upstream);
  assert.equal(first.stdout.match(new RegExp(NOTICE.source, 'gm')).length, 1, 'one notice');
  assert.match(first.stdout, /hook scripts in this session run the new code from the next tool call/, 'in place, the hooks run the checkout');
  assert.equal(validations(log), 1);

  const fetchHead = path.join(managed, '.git', 'FETCH_HEAD');
  const fetchedAt = fs.statSync(fetchHead).mtimeMs;
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, NOTICE, 'nothing changed, so no notice');
  assert.equal(validations(log), 1, 'no validation when the checkout matches the remote');
  assert.equal(fs.statSync(fetchHead).mtimeMs, fetchedAt, 'no fetch when the checkout matches the remote');
  const check = readJson(path.join(root, '.ai-agent-toolkit', 'remote-check.json'));
  assert.equal(check.commit, upstream);

  // Within ten minutes of that check the remote is not even asked: an unreachable origin changes nothing.
  fs.renameSync(origin, `${origin}.away`);
  const third = run();
  assert.equal(third.status, 0, third.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_status, 'updated', 'an unchanged start writes no state');
  assert.equal(validations(log), 1);
  assert.equal(third.stdout.trim(), '', 'an unchanged start prints nothing');

  // After ten minutes it asks again, finds no remote, and the full path reports the fetch failure.
  writeJson(path.join(root, '.ai-agent-toolkit', 'remote-check.json'), { ...check, checked_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
  const fourth = run();
  assert.equal(fourth.status, 0, fourth.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_status, 'skipped');
  assert.match(readJson(path.join(hub, 'state.json')).last_repo_update_error, /fetch failed/);

  // A new upstream commit is picked up again once the remote is back.
  fs.renameSync(`${origin}.away`, origin);
  fs.writeFileSync(path.join(seed, 'NEWS.txt'), 'two\n');
  git(seed, ['commit', '-am', 'two']);
  git(seed, ['push', 'origin', 'main']);
  const fifth = run();
  assert.equal(fifth.status, 0, fifth.stderr);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), git(seed, ['rev-parse', 'HEAD']));
  assert.match(fifth.stdout, NOTICE);
});

test('a checkout moved by hand runs the full path once even when it matches the remote', (t) => {
  const root = tmpRoot(t);
  const { origin, managed, upstream } = staleManagedCheckout(root);
  installToolkit(root, managed);
  const hub = recordCheckout(root, managed, origin, { last_repo_update_status: 'up-to-date', last_repo_update_to_commit: git(managed, ['rev-parse', 'HEAD']) });
  git(managed, ['pull', '--ff-only', 'origin', 'main']);
  const log = path.join(root, 'validations.log');
  const result = hook(root, hub, managed, { bridge: path.join(managed, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), extra: { TOOLKIT_TEST_VALIDATION_LOG: log } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(validations(log), 1, 'the hand-moved tree is validated');
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_to_commit, upstream);
  assert.doesNotMatch(result.stdout, NOTICE, 'this start moved nothing itself');
});

test('a computer where automatic updates were turned off updates anyway and records when that was overridden', (t) => {
  const root = tmpRoot(t);
  const { origin, managed, upstream } = staleManagedCheckout(root);
  installToolkit(root, managed);
  const hub = recordCheckout(root, managed, origin, { repo_auto_update_enabled: false, auto_sync_enabled: false });
  const result = hook(root, hub, managed, { bridge: path.join(managed, 'repo', 'scripts', 'toolkit-local-bridge.cjs') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), upstream);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.repo_auto_update_enabled, true, 'older Toolkit copies reading the key keep updating too');
  assert.match(state.auto_update_forced_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('the bridge no longer takes the automatic-update switches', () => {
  for (const flag of ['--enable-repo-auto-update', '--disable-repo-auto-update']) {
    const result = spawnSync(process.execPath, [script, flag], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Unknown argument: ${flag}`));
  }
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(help.stdout, /enable-repo-auto-update|disable-repo-auto-update/);
});

test('the update notice lists the changelog titles between the versions and the global rules and new-session lines', () => {
  const changelog = [
    '# Changelog', '', '## 2.1.0 (title words)', '', '### Added', '', '- **Newest thing:** detail.', '- plain bullet without a title', '',
    '## 2.0.1', '', '- **Middle fix:** detail.', '', '## 2.0.0', '', '- **Old thing:** never shown.', '',
  ].join('\n');
  assert.deepEqual(changesBetween(changelog, '2.0.0', '2.1.0'), ['Newest thing', 'plain bullet without a title', 'Middle fix']);
  assert.deepEqual(changesBetween(changelog, '2.1.0', '2.1.0'), []);
  assert.deepEqual(changesBetween(changelog, 'abc', '2.1.0'), []);

  const files = { from: { 'repo/contracts/toolkit-local-bridge/version.json': '{"version":"2.0.0"}' },
    to: { 'repo/contracts/toolkit-local-bridge/version.json': '{"version":"2.1.0"}', 'repo/docs/CHANGELOG.md': changelog } };
  const git = (args) => {
    if (args[0] === 'show') { const [commit, file] = args[1].split(':'); const text = files[commit][file]; return text ? { ok: true, stdout: text } : { ok: false, stdout: '' }; }
    if (args[0] === 'diff') return { ok: true, stdout: 'skills/new-skill/SKILL.md\n' };
    return { ok: false, stdout: '' };
  };
  const environment = { USERPROFILE: path.join(os.tmpdir(), 'home'), HOME: path.join(os.tmpdir(), 'home') };
  const notice = updateNotice({ git, fromCommit: 'from', toCommit: 'to', changedFiles: ['repo/contracts/agent-rules/global-rules.md'], environment });
  const lines = notice.split('\n');
  assert.equal(lines[0], 'Toolkit update notice: this session start updated Toolkit on this computer from 2.0.0 to 2.1.0.');
  assert.ok(lines.includes('- Newest thing') && lines.includes('- Middle fix'));
  assert.ok(notice.includes("Toolkit's global rules changed: before your next step, read the GLOBAL-RULES block in ~/.claude/CLAUDE.md again"), notice);
  assert.match(notice, /take effect only in a new session/);
  assert.equal(updateNotice({ git, fromCommit: 'to', toCommit: 'to' }), '', 'nothing moved, no notice');

  // Bounded: at most MAX_CHANGES titles and a count of the rest, far inside the 10,000-character limit.
  const many = ['## 3.0.0', ...Array.from({ length: 40 }, (_, index) => `- **${'x'.repeat(300)} ${index}:** y`)].join('\n');
  files.to['repo/docs/CHANGELOG.md'] = many;
  files.to['repo/contracts/toolkit-local-bridge/version.json'] = '{"version":"3.0.0"}';
  const big = updateNotice({ git, fromCommit: 'from', toCommit: 'to', changedFiles: [], environment });
  assert.equal(big.split('\n').filter((line) => line.startsWith('- ') && !line.startsWith('- and ')).length, MAX_CHANGES);
  assert.match(big, /- and 25 more in repo\/docs\/CHANGELOG\.md/);
  assert.ok(big.length < 4000, `${big.length} characters`);
  assert.doesNotMatch(big, /global rules changed/);
});

test('the tree-moving marker makes a reader wait, and a stale, dead or missing one does not', (t) => {
  const root = tmpRoot(t);
  assert.equal(marker.waitForSteadyTree(root, { timeoutMs: 0 }), true, 'no marker');
  let seen = false;
  marker.whileTreeMoves(root, () => { seen = fs.existsSync(marker.markerPath(root)); });
  assert.equal(seen, true);
  assert.equal(fs.existsSync(marker.markerPath(root)), false, 'removed after the move');
  // A live writer: the reader waits, then gives up at the deadline.
  fs.writeFileSync(marker.markerPath(root), JSON.stringify({ pid: process.pid }));
  let clock = Date.now();
  let sleeps = 0;
  const waited = marker.waitForSteadyTree(root, { timeoutMs: 1000, now: () => clock, sleep: (ms) => { sleeps += 1; clock += ms; } });
  assert.equal(waited, false);
  assert.ok(sleeps >= 9, `${sleeps} polls`);
  // The writer finishing mid-wait releases the reader.
  let polls = 0;
  assert.equal(marker.waitForSteadyTree(root, { timeoutMs: 1000, sleep: () => { polls += 1; if (polls === 2) fs.rmSync(marker.markerPath(root)); } }), true);
  // A writer that has exited, or a marker older than the stale age, does not hold anyone.
  fs.writeFileSync(marker.markerPath(root), JSON.stringify({ pid: 999999 }));
  assert.equal(marker.waitForSteadyTree(root, { timeoutMs: 0, alive: () => false }), true);
  fs.writeFileSync(marker.markerPath(root), JSON.stringify({ pid: process.pid }));
  assert.equal(marker.waitForSteadyTree(root, { timeoutMs: 0, now: () => Date.now() + marker.STALE_MS + 1000 }), true);
});

test('the governance hook reads no governance state while an update is moving the checkout, and does once it is steady', (t) => {
  const root = tmpRoot(t);
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'work');
  fs.mkdirSync(cwd, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_REMOTE;
  const hookScript = path.join(repoRoot, 'repo', 'scripts', 'toolkit-governance-hook.cjs');
  const sessionStart = (environment) => {
    const result = spawnSync(process.execPath, [hookScript, '--event', 'SessionStart'],
      { input: JSON.stringify({ cwd, session_id: 's1', source: 'startup' }), env: environment, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext || '';
  };
  const { TREE_MOVING } = require(hookScript);
  const file = marker.markerPath(marker.defaultControlRoot(env));
  // A live update holds the marker for longer than the hook waits.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }));
  const started = Date.now();
  assert.equal(sessionStart(env), TREE_MOVING);
  assert.ok(Date.now() - started >= marker.WAIT_MS, 'waited for the update first');
  fs.rmSync(file);
  assert.notEqual(sessionStart(env), TREE_MOVING, 'a steady tree gets the governance state');
  // A cloud session has no managed checkout to wait for.
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid }));
  assert.notEqual(sessionStart({ ...env, CLAUDE_CODE_REMOTE: 'true' }), TREE_MOVING);
});
