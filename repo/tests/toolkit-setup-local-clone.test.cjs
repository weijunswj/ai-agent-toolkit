'use strict';

// Setup fast-forwards the user's own clone of Toolkit only when it is clean and on the default branch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-local-clone-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  git(root, 'clone', origin, seed);
  fs.mkdirSync(path.join(seed, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'repo', 'scripts', 'setup-toolkit.cjs'), '// fixture\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'one');
  git(seed, 'push', 'origin', 'HEAD:main');
  const clone = path.join(root, 'my clone');
  git(root, 'clone', origin, clone);
  const pushNew = (name) => { fs.writeFileSync(path.join(seed, name), `${name}\n`); git(seed, 'add', '-A'); git(seed, 'commit', '-m', name); git(seed, 'push', 'origin', 'HEAD:main'); return git(seed, 'rev-parse', 'HEAD'); };
  const args = { repoRoot: path.join(root, 'managed'), repoRemote: origin, repoBranch: 'main' };
  return { clone, pushNew, args };
}

test('a clean clone on main fast-forwards; a second run is current', (t) => {
  const f = fixture(t);
  const head = f.pushNew('two.txt');
  const result = core.fastForwardLocalClone(f.args, f.clone);
  assert.deepEqual(result, { status: 'fast-forwarded', commit: head });
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(core.fastForwardLocalClone(f.args, f.clone), { status: 'current' });
});

test('a dirty clone, another branch or a diverged main is skipped with the reason and left exactly as it was', (t) => {
  const f = fixture(t);
  f.pushNew('two.txt');
  fs.writeFileSync(path.join(f.clone, 'local.txt'), 'mine\n');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /uncommitted changes/);
  fs.rmSync(path.join(f.clone, 'local.txt'));
  git(f.clone, 'switch', '-c', 'feature');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /on feature, not main/);
  git(f.clone, 'switch', 'main');
  fs.writeFileSync(path.join(f.clone, 'ahead.txt'), 'ahead\n');
  git(f.clone, 'add', '-A');
  git(f.clone, 'commit', '-m', 'local only');
  const before = git(f.clone, 'rev-parse', 'HEAD');
  assert.match(core.fastForwardLocalClone(f.args, f.clone).reason, /cannot fast-forward/);
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), before);
});

test('the managed checkout itself and folders that are not Toolkit clones are left alone', (t) => {
  const f = fixture(t);
  assert.equal(core.fastForwardLocalClone({ ...f.args, repoRoot: f.clone }, f.clone), null);
  assert.equal(core.fastForwardLocalClone({ ...f.args, repoRemote: 'https://github.com/someone/else' }, f.clone), null);
  assert.equal(core.fastForwardLocalClone(f.args, os.tmpdir()), null);
});

// A managed checkout on another branch, one commit behind its local origin's main, with git hooks that log
// whether the bridge's moving marker is held while git switches (post-checkout) and fast-forwards
// (post-merge) its files. The files are the ones setup checks before it moves anything.
function managedFixture(t) {
  const marker = require('../scripts/toolkit-update-marker.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-managed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '--bare', '-b', 'main', origin);
  const seed = path.join(root, 'seed');
  git(root, 'clone', origin, seed);
  const files = ['AGENTS.md', 'repo/scripts/setup-codex-toolkit-plugin.cjs', 'repo/scripts/setup-claude-toolkit-plugin.cjs', 'repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/validate-toolkit.cjs'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true }); fs.writeFileSync(path.join(seed, file), '// fixture\n'); }
  fs.mkdirSync(path.join(seed, 'repo', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), "require('node:test')('fixture', () => {});\n");
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'one');
  git(seed, 'push', 'origin', 'HEAD:main');
  const managed = path.join(root, 'managed');
  git(root, 'clone', origin, managed);
  git(managed, 'switch', '-c', 'other');
  fs.writeFileSync(path.join(seed, 'two.txt'), 'two\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-m', 'two');
  git(seed, 'push', 'origin', 'HEAD:main');
  const control = path.join(root, 'control');
  const moving = marker.markerPath(control).replace(/\\/g, '/');
  const log = path.join(root, 'moves.log').replace(/\\/g, '/');
  const hooks = path.join(root, 'hooks');
  fs.mkdirSync(hooks);
  for (const [hook, move] of [['post-checkout', 'switch'], ['post-merge', 'merge']]) {
    fs.writeFileSync(path.join(hooks, hook), `#!/bin/sh\nif [ -e "${moving}" ]; then echo "${move} held" >> "${log}"; else echo "${move} free" >> "${log}"; fi\n`, { mode: 0o755 });
  }
  git(managed, 'config', 'core.hooksPath', hooks.replace(/\\/g, '/'));
  const args = { repoRoot: managed, repoRemote: origin, repoBranch: 'main', repoRootExplicit: true, hub: path.join(control, 'current') };
  const moves = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : []);
  return { marker, managed, control, args, moves, ahead: git(seed, 'rev-parse', 'HEAD') };
}

// Setup once switched and fast-forwarded the managed checkout unguarded; the review found the guard was
// tested only through its helper, so unwrapping both moves left every setup test green. This runs the
// real setup step.
test('setup switches and fast-forwards the managed checkout holding the moving marker, and moves nothing while a reader reads', (t) => {
  const f = managedFixture(t);
  const before = git(f.managed, 'rev-parse', 'HEAD');
  fs.mkdirSync(f.marker.readersPath(f.control), { recursive: true });
  const reader = path.join(f.marker.readersPath(f.control), 'reader');
  fs.writeFileSync(reader, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  assert.throws(() => core.verifyAndUpdateTrustedRepo(f.args, []), /still reading Toolkit's files after 15 seconds, so setup did not move them; run setup again/);
  assert.equal(git(f.managed, 'rev-parse', 'HEAD'), before, 'HEAD unchanged');
  assert.equal(git(f.managed, 'branch', '--show-current'), 'other', 'branch unchanged');
  assert.deepEqual(f.moves(), [], 'git moved nothing');
  fs.rmSync(reader);
  const result = core.verifyAndUpdateTrustedRepo(f.args, []);
  assert.equal(result.update_action, 'fast-forwarded');
  assert.equal(git(f.managed, 'rev-parse', 'HEAD'), f.ahead);
  assert.equal(git(f.managed, 'branch', '--show-current'), 'main');
  assert.deepEqual(f.moves(), ['switch held', 'merge held'], 'each move ran while the marker was held');
  assert.equal(fs.existsSync(f.marker.markerPath(f.control)), false, 'no marker left');
});

// Setup moves the managed checkout's files (switch, fast-forward) under the bridge's moving marker, so a
// session-start hook reading Toolkit in place never loads half-moved modules; it once moved them unguarded.
test('setup moves the managed checkout only under the moving marker, and never while a reader holds on', (t) => {
  const marker = require('../scripts/toolkit-update-marker.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-move-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const args = { hub: path.join(root, 'current') };
  let seen = null;
  assert.equal(core.whileManagedTreeMoves(args, () => { seen = fs.existsSync(marker.markerPath(root)); return 'moved'; }), 'moved');
  assert.equal(seen, true, 'the marker is held while the files move');
  assert.equal(fs.existsSync(marker.markerPath(root)), false, 'and released after');
  fs.mkdirSync(marker.readersPath(root), { recursive: true });
  fs.writeFileSync(path.join(marker.readersPath(root), 'reader'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  let ran = false;
  assert.throws(() => core.whileManagedTreeMoves(args, () => { ran = true; }, { timeoutMs: 50 }), /still reading Toolkit's files after 15 seconds, so setup did not move them; run setup again/);
  assert.equal(ran, false, 'nothing moves while a reader holds on');
  assert.equal(fs.existsSync(marker.markerPath(root)), false);
});
