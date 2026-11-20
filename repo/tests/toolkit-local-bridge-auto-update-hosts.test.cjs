'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// Automatic updates in each place Toolkit runs on a computer: the Claude desktop app's account copy
// hands the session start to the managed checkout's own script, a cloud session stays quiet, and a
// long-running plain-chat controller sees a stale checkout through its health check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  repoRoot, NOTICE, tmpRoot, readJson, git, env, installToolkit, staleManagedCheckout, recordCheckout, accountCopy, hook, writeJson,
} = require('./support/toolkit-auto-update-fixture.cjs');

test('the Claude app account copy hands the session start to the stale managed checkout, which fast-forwards', (t) => {
  const root = tmpRoot(t);
  const { origin, managed, upstream } = staleManagedCheckout(root);
  // A PC that only uses the desktop app: Claude Code CLI has no install record for the checkout.
  const hub = recordCheckout(root, managed, origin);
  const result = hook(root, hub, accountCopy(root));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), upstream, 'the managed checkout was fast-forwarded');
  assert.match(result.stdout, /^Toolkit: this Claude app chat runs the Toolkit copy from the claude\.ai account, so session-start maintenance runs from this PC's Toolkit folder\.$/m);
  assert.doesNotMatch(result.stdout, /uninstalled Toolkit copy/);
  assert.match(result.stdout, NOTICE);
  // The checkout's own script recorded the run; the account copy wrote nothing of its own.
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'updated');
  assert.equal(state.last_repo_update_to_commit, upstream);
  assert.equal(state.last_sync_source, 'claude-plugin');
  // The notice does not claim the account copy's hooks run the checkout's new code.
  assert.doesNotMatch(result.stdout, /hook scripts in this session run the new code/);
});

test('the hand-off needs a recorded checkout; a --plugin-dir copy never hands off or moves the checkout', (t) => {
  const root = tmpRoot(t);
  const { origin, managed } = staleManagedCheckout(root);
  // Claude Code CLI runs another folder, so nothing here is the installed copy of the checkout.
  installToolkit(root, repoRoot);
  const head = git(managed, ['rev-parse', 'HEAD']);
  // No hub state: the account copy says so and does nothing.
  const none = hook(root, path.join(root, 'no-hub', 'current'), accountCopy(root));
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /uninstalled Toolkit copy/);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), head);
  // A test candidate outside the app's folders, with hub state naming the checkout.
  const hub = recordCheckout(root, managed, origin);
  const before = fs.readFileSync(path.join(hub, 'state.json'), 'utf8');
  const candidate = hook(root, hub, repoRoot);
  assert.equal(candidate.status, 0, candidate.stderr);
  assert.match(candidate.stdout, /uninstalled Toolkit copy/);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), head, 'a candidate never moves the checkout');
  assert.equal(fs.readFileSync(path.join(hub, 'state.json'), 'utf8'), before, 'a candidate never writes state');
  // A forged hand-off from a folder outside the app's account-plugin folders counts for nothing.
  const forged = hook(root, hub, managed, { extra: { TOOLKIT_BRIDGE_HANDOFF_FROM: repoRoot } });
  assert.equal(forged.status, 0, forged.stderr);
  assert.match(forged.stdout, /uninstalled Toolkit copy/, 'the registry still decides for a non-account hand-off');
});

test('a plain-chat controller check reports a stale checkout, and the command it names updates it with the notice', (t) => {
  const root = tmpRoot(t);
  const { origin, managed, upstream } = staleManagedCheckout(root);
  const hub = recordCheckout(root, managed, origin);
  const { controllerCheck, parseArgs, CHECKS } = require('../scripts/toolkit-controller-check.cjs');
  const options = parseArgs(['--host', 'chat', '--skip', CHECKS.filter((name) => name !== 'toolkit').join(',')]);
  const report = controllerCheck(options, { readHubState: () => readJson(path.join(hub, 'state.json')) });
  const row = report.checks.find((check) => check.name === 'toolkit');
  assert.equal(row.state, 'attention', row.lines.join('\n'));
  const [, scriptPath, ...flags] = /^node "([^"]+)" (.+)$/.exec(row.command);
  assert.equal(path.resolve(scriptPath), path.resolve(managed, 'repo', 'scripts', 'toolkit-local-bridge.cjs'));
  const result = spawnSync(process.execPath, [scriptPath, ...flags.join(' ').split(' ')], { cwd: root, encoding: 'utf8', timeout: 300000, env: env(root) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), upstream);
  assert.match(result.stdout, NOTICE);
  const after = controllerCheck(options, { readHubState: () => readJson(path.join(hub, 'state.json')) });
  assert.equal(after.checks.find((check) => check.name === 'toolkit').state, 'ok');
});

test('a cloud session says nothing about its synced copy unless a Toolkit repository it works in is newer', (t) => {
  const root = tmpRoot(t);
  const hub = path.join(root, 'no-hub', 'current');
  const quiet = hook(root, hub, accountCopy(root), { extra: { CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout.trim(), '');
  const workspace = path.join(root, 'newer-toolkit');
  writeJson(path.join(workspace, '.claude-plugin', 'plugin.json'), { name: 'ai-agent-toolkit', version: '999.0.0' });
  writeJson(path.join(workspace, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), { version: '999.0.0' });
  const stale = hook(root, hub, accountCopy(root), { extra: { CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /older than the 999\.0\.0 in the Toolkit repository/);
});

test('an account copy behind a checkout commit from the last hour gets no reminder; claude.ai is still syncing it', (t) => {
  const root = tmpRoot(t);
  const { origin, managed } = staleManagedCheckout(root);
  installToolkit(root, managed);
  const hub = recordCheckout(root, managed, origin);
  const result = hook(root, hub, accountCopy(root, '0.0.1'));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /systemMessage|update reminder/);
});
