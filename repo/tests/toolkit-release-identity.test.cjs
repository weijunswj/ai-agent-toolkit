'use strict';

// Release identity: "fixed" means the copy this host runs has the fix. The check finds the first
// Toolkit version that holds a merged commit, then reports each Toolkit copy it can find on this host
// as delivered, not delivered or unknown. An unreadable copy is unknown, never delivered.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const identity = require('../scripts/toolkit-release-identity.cjs');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'toolkit-release-identity.cjs');
const VERSION_REL = ['repo', 'contracts', 'toolkit-local-bridge', 'version.json'];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const setVersion = (root, version) => writeFile(path.join(root, ...VERSION_REL), `${JSON.stringify({ version }, null, 2)}\n`);

// A Toolkit history on main: 1.0.0 at `old`; a fix branch whose commit `fix` merges as `merge` with the
// bump to 1.1.0 made on the branch; `later` lands on main with no bump; `direct` bumps to 1.2.0.
function history(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-release-identity-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const repo = path.join(work, 'toolkit');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  setVersion(repo, '1.0.0');
  pluginCopy(repo, '1.0.0');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  const old = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'fix');
  writeFile(path.join(repo, 'fix.txt'), 'fixed\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the fix');
  const fix = git(repo, 'rev-parse', 'HEAD');
  setVersion(repo, '1.1.0');
  git(repo, 'commit', '-q', '-am', 'bump minor');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge the fix', 'fix');
  const merge = git(repo, 'rev-parse', 'HEAD');
  writeFile(path.join(repo, 'later.txt'), 'later\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'later, no bump');
  const later = git(repo, 'rev-parse', 'HEAD');
  setVersion(repo, '1.2.0');
  git(repo, 'commit', '-q', '-am', 'bump to 1.2.0');
  const direct = git(repo, 'rev-parse', 'HEAD');
  return { work, repo, old, fix, merge, later, direct };
}

// A plugin folder holding one version, the shape every installed copy has.
function pluginCopy(dir, version) {
  writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'ai-agent-toolkit', version })}\n`);
  return dir;
}

// A host with no Toolkit copy at all; each test adds the copies it needs.
function host(work) {
  const home = path.join(work, 'home');
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') };
  return { home, environment, hubPath: path.join(home, '.ai-agent-toolkit', 'current'), guidebookDir: path.join(work, 'no-guidebook') };
}

function managedCheckout(h, repoPath) {
  writeFile(path.join(h.hubPath, 'state.json'), `${JSON.stringify({ repo_path: repoPath })}\n`);
}

function claudeCodePlugin(h, root) {
  const plugins = path.join(h.environment.CLAUDE_CONFIG_DIR, 'plugins');
  writeFile(path.join(plugins, 'known_marketplaces.json'), `${JSON.stringify({ 'ai-agent-toolkit-local': { source: { source: 'directory', path: root } } })}\n`);
  writeFile(path.join(plugins, 'installed_plugins.json'), `${JSON.stringify({ plugins: { 'ai-agent-toolkit@ai-agent-toolkit-local': [{ scope: 'user' }] } })}\n`);
}

function accountCopy(h, version, { pluginJson } = {}) {
  const folder = path.join(h.environment.LOCALAPPDATA, 'Claude-Data', 'claude_app', 'rpm', 'a', 'b');
  writeFile(path.join(folder, 'manifest.json'), `${JSON.stringify({ plugins: [{ name: 'ai-agent-toolkit', id: 'plugin_x' }] })}\n`);
  if (pluginJson !== undefined) writeFile(path.join(folder, 'plugin_x', '.claude-plugin', 'plugin.json'), pluginJson);
  else pluginCopy(path.join(folder, 'plugin_x'), version);
}

function syncedCopy(h, version) {
  pluginCopy(path.join(h.environment.CLAUDE_CONFIG_DIR, 'plugins', 'synced', 'org_project', 'ai-agent-toolkit'), version);
}

function guidebook(h, commit7) {
  h.guidebookDir = path.join(path.dirname(h.hubPath), 'guidebook');
  writeFile(path.join(h.guidebookDir, 'VERSION'), `Version: 2026-11-15.2 toolkit 1.0.0 main ${commit7} copied 2026-11-15T05:38:22Z\n`);
}

const check = (repo, h, target) => new identity.ReleaseIdentityCheck({ repoRoot: repo, ref: 'main', hubPath: h.hubPath, environment: h.environment, guidebookDir: h.guidebookDir }).check(target);
const stateOf = (result, id) => result.copies.find((copy) => copy.id === id)?.state;

test('the first version holding a commit is the first bump on main after it lands', (t) => {
  const h = history(t);
  const run = new identity.ReleaseIdentityCheck({ repoRoot: h.repo, ref: 'main' });
  assert.deepEqual(run.firstVersion(h.fix), { commit: h.fix, merged: true, version: '1.1.0' }, 'a branch commit ships with its merge');
  assert.deepEqual(run.firstVersion(h.merge), { commit: h.merge, merged: true, version: '1.1.0' }, 'the merge commit itself');
  assert.deepEqual(run.firstVersion(h.later), { commit: h.later, merged: true, version: '1.2.0' }, 'a commit with no bump ships with the next one');
  assert.deepEqual(run.firstVersion(h.direct), { commit: h.direct, merged: true, version: '1.2.0' }, 'a bump commit ships its own version');
  const tip = (() => { writeFile(path.join(h.repo, 'tip.txt'), 'tip\n'); git(h.repo, 'add', '-A'); git(h.repo, 'commit', '-q', '-m', 'tip'); return git(h.repo, 'rev-parse', 'HEAD'); })();
  assert.deepEqual(run.firstVersion(tip), { commit: tip, merged: true, version: '' }, 'no version holds it yet');
  git(h.repo, 'checkout', '-q', '-b', 'side', h.old);
  writeFile(path.join(h.repo, 'side.txt'), 'side\n');
  git(h.repo, 'add', '-A');
  git(h.repo, 'commit', '-q', '-m', 'never merged');
  const side = git(h.repo, 'rev-parse', 'HEAD');
  git(h.repo, 'checkout', '-q', 'main');
  assert.equal(run.firstVersion(side).merged, false, 'a commit main does not hold');
  assert.match(run.firstVersion('0'.repeat(40)).reason, /not found/);
});

test('E4-1: a host on an older build is not delivered, and current copies are delivered', (t) => {
  const h = history(t);
  const hostA = host(h.work);
  const behind = path.join(h.work, 'behind');
  git(h.work, 'clone', '-q', h.repo, behind);
  git(behind, 'checkout', '-q', h.old);
  managedCheckout(hostA, behind);
  claudeCodePlugin(hostA, behind);
  accountCopy(hostA, '1.0.0');
  syncedCopy(hostA, '1.1.0');
  guidebook(hostA, h.old.slice(0, 7));
  const result = check(h.repo, hostA, { commit: h.fix });
  assert.equal(result.min_version, '1.1.0');
  assert.equal(stateOf(result, 'managed-checkout'), 'not-delivered', 'the checkout does not hold the commit');
  assert.equal(stateOf(result, 'claude-code-plugin'), 'not-delivered', 'Claude Code runs the same checkout');
  assert.equal(stateOf(result, 'claude-account-copy'), 'not-delivered', 'an account copy on 1.0.0');
  assert.equal(stateOf(result, 'cloud-synced-plugin'), 'delivered', 'a synced copy on 1.1.0');
  assert.equal(stateOf(result, 'projects-guidebook'), 'not-delivered', 'a guidebook copied before the fix');
  assert.equal(result.result, 'not-delivered');

  const hostB = host(path.join(h.work, 'b'));
  managedCheckout(hostB, h.repo);
  accountCopy(hostB, '1.2.0');
  guidebook(hostB, h.merge.slice(0, 7));
  const current = check(h.repo, hostB, { commit: h.fix });
  assert.equal(stateOf(current, 'managed-checkout'), 'delivered');
  assert.equal(stateOf(current, 'claude-account-copy'), 'delivered');
  assert.equal(stateOf(current, 'projects-guidebook'), 'delivered');
  assert.equal(stateOf(current, 'claude-code-plugin'), 'absent');
  assert.equal(stateOf(current, 'cloud-synced-plugin'), 'absent');
  assert.equal(current.result, 'delivered', 'absent copies do not count');

  const byVersion = check(h.repo, hostA, { minVersion: '1.1.0' });
  assert.equal(stateOf(byVersion, 'managed-checkout'), 'not-delivered', 'the checkout reads 1.0.0');
  assert.equal(stateOf(byVersion, 'cloud-synced-plugin'), 'delivered');
});

test('E4-2: an unreadable copy is unknown, never delivered', (t) => {
  const h = history(t);
  const cases = [
    ['an account copy with a broken plugin.json', (x) => accountCopy(x, '', { pluginJson: '{ not json' }), 'claude-account-copy'],
    ['an account copy with no version', (x) => accountCopy(x, '', { pluginJson: '{"name":"ai-agent-toolkit"}' }), 'claude-account-copy'],
    ['a managed checkout folder that is gone', (x) => managedCheckout(x, path.join(h.work, 'gone')), 'managed-checkout'],
    ['an unreadable update record', (x) => writeFile(path.join(x.hubPath, 'state.json'), '{ broken'), 'managed-checkout'],
    ['a guidebook VERSION in an unknown shape', (x) => { guidebook(x, h.merge.slice(0, 7)); writeFile(path.join(x.guidebookDir, 'VERSION'), 'Version: soon\n'); }, 'projects-guidebook'],
    ['a guidebook copied from a commit this clone lacks', (x) => guidebook(x, 'abcdef0'), 'projects-guidebook'],
    ['a synced copy with a bad version', (x) => syncedCopy(x, 'latest'), 'cloud-synced-plugin'],
    ['a half-recorded Claude Code plugin', (x) => writeFile(path.join(x.environment.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), `${JSON.stringify({ plugins: { 'ai-agent-toolkit@ai-agent-toolkit-local': [{}] } })}\n`), 'claude-code-plugin'],
  ];
  cases.forEach(([label, make, id], index) => {
    const h2 = host(path.join(h.work, `case-${index}`));
    syncedCopy(h2, '1.1.0');
    if (id === 'cloud-synced-plugin') fs.rmSync(path.join(h2.environment.CLAUDE_CONFIG_DIR, 'plugins', 'synced'), { recursive: true });
    make(h2);
    const result = check(h.repo, h2, { commit: h.fix });
    assert.equal(stateOf(result, id), 'unknown', label);
    assert.equal(result.result, 'unknown', `${label}: the host result`);
  });
  const empty = check(h.repo, host(path.join(h.work, 'empty')), { commit: h.fix });
  assert.equal(empty.result, 'unknown', 'no Toolkit copy found');
  const unshipped = host(path.join(h.work, 'unshipped'));
  accountCopy(unshipped, '9.9.9');
  writeFile(path.join(h.repo, 'tip.txt'), 'tip\n');
  git(h.repo, 'add', '-A');
  git(h.repo, 'commit', '-q', '-m', 'tip');
  const tipResult = check(h.repo, unshipped, { commit: git(h.repo, 'rev-parse', 'HEAD') });
  assert.equal(stateOf(tipResult, 'claude-account-copy'), 'unknown', 'a version cannot prove a fix no version holds yet');
  const lost = check(h.repo, unshipped, { commit: 'f'.repeat(40) });
  assert.equal(lost.result, 'unknown', 'a commit this clone does not have');
});

test('the command prints each copy without paths and exits 0 only when delivered', (t) => {
  const h = history(t);
  const h2 = host(h.work);
  managedCheckout(h2, h.repo);
  accountCopy(h2, '1.0.0');
  const env = { ...process.env, ...h2.environment, HOME: h2.home, USERPROFILE: h2.home };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--repo', h.repo, '--ref', 'main', '--hub', h2.hubPath, '--guidebook', h2.guidebookDir, ...args], { encoding: 'utf8', env });
  const behind = run('--commit', h.fix);
  assert.equal(behind.status, 1, behind.stderr);
  assert.match(behind.stdout, /first shipped in Toolkit 1\.1\.0/);
  assert.match(behind.stdout, /claude\.ai account copy: not delivered \(1\.0\.0, needs 1\.1\.0\)/);
  assert.match(behind.stdout, /Result: not delivered/);
  assert.equal(behind.stdout.includes(h.work), false, 'no local path in the report');
  accountCopy(h2, '1.1.0');
  const ok = run('--commit', h.fix, '--json');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).result, 'delivered');
  for (const args of [[], ['--commit', 'nope'], ['--min-version', '1.x'], ['--commit', h.fix, '--min-version', '1.1.0'], ['--bogus']]) {
    assert.equal(run(...args).status, 2, `usage error for ${args.join(' ') || 'no arguments'}`);
  }
});
