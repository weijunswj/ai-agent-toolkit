#!/usr/bin/env node
'use strict';

// Release identity: is a merged fix delivered on this host? "Fixed" means the copy a host runs has the
// fix, not that the pull request merged. Given the fix's commit, this finds the first Toolkit version
// that holds it, then reports each Toolkit copy it can find on the host it runs on, and only that host:
//   managed-checkout     the checkout the Toolkit update record points at (repo_path)
//   claude-code-plugin   the folder Claude Code runs the Toolkit plugin from
//   claude-account-copy  the Claude desktop app's copy from the user's claude.ai account
//   cloud-synced-plugin  the plugin copy a claude.ai cloud session syncs in
//   projects-guidebook   the Projects controller guidebook copy (its VERSION names the main commit)
// Each copy is delivered, not-delivered, unknown or absent (not on this host). A git checkout is judged
// by whether its HEAD holds the commit; other copies by their version against the first version that
// holds it. Anything that cannot be read or proved is unknown, never delivered. The host result is
// delivered only when every copy found is delivered.
//
// Usage: node repo/scripts/toolkit-release-identity.cjs (--commit <sha> | --min-version <x.y.z>)
//          [--repo <Toolkit checkout>] [--ref <ref>] [--hub <path>] [--guidebook <folder>] [--json]
// --repo is the clone that resolves the commit (default: this checkout; fetch main first), --ref the
// branch whose history counts (default origin/main). Exit 0 delivered, 1 not delivered or unknown,
// 2 usage error. It reads only; it never fetches, installs or changes a copy.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const { samePath } = require('./toolkit-canonical-path.cjs');
const { ClaudePluginRegistry } = require('./toolkit-claude-plugin-registry.cjs');
const { claudeAccountPluginFolders } = require('./toolkit-claude-account-copy.cjs');
const { SEMVER, VERSION_REL_PATH } = require('./toolkit-version.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REF = 'origin/main';
const DEFAULT_GUIDEBOOK = '/mnt/project-files/toolkit/web-controller-projects';
const PLUGIN_NAME = 'ai-agent-toolkit';
const PLUGIN_JSON = ['.claude-plugin', 'plugin.json'];
const COMMIT = /^[0-9a-f]{7,40}$/;
const PLUGIN_ID = /^[A-Za-z0-9_-]+$/;
// The guidebook's VERSION line (toolkit-projects-guidebook.cjs writes it): skill Version, Toolkit
// version, the main commit it was copied from and when.
const GUIDEBOOK_LINE = /^Version: \d{4}-\d{2}-\d{2}\.\d+ toolkit (\d+\.\d+\.\d+) main ([0-9a-f]{7}) copied \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n?$/;
const STATES = Object.freeze({ DELIVERED: 'delivered', NOT: 'not-delivered', UNKNOWN: 'unknown', ABSENT: 'absent' });
const WORDS = Object.freeze({ delivered: 'delivered', 'not-delivered': 'not delivered', unknown: 'unknown', absent: 'not on this host' });

class UsageError extends Error {}

function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

// A JSON file: { missing: true }, { value }, or { error } when it exists but cannot be read.
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? { missing: true } : { error: error.code || 'unreadable' }; }
  try { return { value: JSON.parse(text.replace(/^﻿/, '')) }; }
  catch { return { error: 'not valid JSON' }; }
}

// Runs git with no shell, resolved from PATH (never a git planted in the folder), with no fsmonitor.
function runGit(cwd, args) {
  let git;
  try { git = resolvePathExecutable('git'); } catch { return { status: -1, stdout: '' }; }
  const result = spawnSync(git, ['-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, shell: false });
  return { status: result.status === null ? -1 : result.status, stdout: result.stdout || '' };
}

class ReleaseIdentityCheck {
  #repo; #ref; #hubPath; #environment; #guidebookDir; #git; #homeDir;

  constructor({ repoRoot = ROOT, ref = DEFAULT_REF, hubPath, environment = process.env, homeDir = os.homedir(), guidebookDir = DEFAULT_GUIDEBOOK, git = runGit } = {}) {
    this.#repo = path.resolve(repoRoot);
    this.#ref = ref;
    this.#homeDir = homeDir;
    this.#hubPath = path.resolve(hubPath || path.join(homeDir, '.ai-agent-toolkit', 'current'));
    this.#environment = environment || {};
    this.#guidebookDir = guidebookDir;
    this.#git = git;
  }

  // The full commit id in `cwd`, or '' when that clone does not have it.
  #resolve(cwd, commit) {
    const shown = this.#git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
    return shown.status === 0 ? shown.stdout.trim() : '';
  }

  // true, false, or null when git cannot answer.
  #holds(cwd, ancestor, descendant) {
    const status = this.#git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]).status;
    return status === 0 ? true : status === 1 ? false : null;
  }

  #versionAt(commit) {
    const shown = this.#git(this.#repo, ['show', `${commit}:${VERSION_REL_PATH}`]);
    if (shown.status !== 0) return '';
    try { const version = JSON.parse(shown.stdout).version; return SEMVER.test(version || '') ? version : ''; }
    catch { return ''; }
  }

  // The first Toolkit version on the ref's main line that holds `commit`: walk the first-parent
  // commits that hold it, oldest first, and take the first version above the one main had just before
  // it landed. { commit, merged, version } with version '' when no version holds it yet.
  firstVersion(commit) {
    const full = this.#resolve(this.#repo, commit);
    if (!full) return { commit, merged: false, version: '', reason: `commit ${commit} was not found in this clone; fetch the ref first` };
    const ref = this.#resolve(this.#repo, this.#ref);
    if (!ref) return { commit: full, merged: false, version: '', reason: `${this.#ref} was not found in this clone` };
    if (this.#holds(this.#repo, full, ref) !== true) return { commit: full, merged: false, version: '', reason: `${this.#ref} does not hold commit ${full.slice(0, 7)}` };
    // Along the main line, oldest first, the commits that hold it are a tail: find where it starts.
    const mainLine = this.#git(this.#repo, ['rev-list', '--first-parent', '--reverse', ref]).stdout.split('\n').filter(Boolean);
    let [low, high] = [0, mainLine.length];
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const holds = this.#holds(this.#repo, full, mainLine[middle]);
      if (holds === null) return { commit: full, merged: false, version: '', reason: 'git could not compare commits in this clone' };
      if (holds) high = middle; else low = middle + 1;
    }
    const chain = mainLine.slice(low);
    if (!chain.length) return { commit: full, merged: false, version: '', reason: `no commit on ${this.#ref} holds ${full.slice(0, 7)}` };
    const parent = this.#resolve(this.#repo, `${chain[0]}^1`);
    const before = parent ? this.#versionAt(parent) : '';
    for (const step of chain) {
      const version = this.#versionAt(step);
      if (version && (!before || compareVersions(version, before) > 0)) return { commit: full, merged: true, version };
    }
    return { commit: full, merged: true, version: '' };
  }

  // One copy's state from what it holds: a git checkout's HEAD, a main commit, or a version.
  #judge({ gitRoot = '', mainCommit = '', version = '' }, target) {
    if (target.commit && gitRoot && this.#resolve(gitRoot, target.commit)) {
      const head = this.#holds(gitRoot, target.commit, 'HEAD');
      if (head !== null) return head ? [STATES.DELIVERED, 'its checkout holds the commit'] : [STATES.NOT, 'its checkout does not hold the commit'];
    }
    if (target.commit && mainCommit) {
      const resolved = this.#resolve(this.#repo, mainCommit);
      const holds = resolved ? this.#holds(this.#repo, target.commit, resolved) : null;
      if (holds !== null) return holds ? [STATES.DELIVERED, `copied from main ${mainCommit}, which holds the commit`] : [STATES.NOT, `copied from main ${mainCommit}, before the commit`];
      return [STATES.UNKNOWN, `copied from main ${mainCommit}, which this clone cannot place; fetch the ref first`];
    }
    if (!version) return [STATES.UNKNOWN, 'no version could be read'];
    if (!target.minVersion) return [STATES.UNKNOWN, `${version}; no Toolkit version holds the commit yet, so a version cannot prove it`];
    return compareVersions(version, target.minVersion) >= 0
      ? [STATES.DELIVERED, version]
      : [STATES.NOT, `${version}, needs ${target.minVersion}`];
  }

  #pluginVersion(root) {
    const read = readJson(path.join(root, ...PLUGIN_JSON));
    if (read.missing || read.error) return { error: read.missing ? 'no plugin.json' : read.error };
    return SEMVER.test(read.value?.version || '') ? { version: read.value.version } : { error: 'plugin.json has no version' };
  }

  // Only a folder that is itself the top of a git checkout, never one inside another repository.
  #isGitCheckout(root) {
    const top = this.#git(root, ['rev-parse', '--show-toplevel']);
    return top.status === 0 && samePath(top.stdout.trim(), root);
  }

  // Each copy as { id, label, found, error?, gitRoot?, mainCommit?, version? }.
  #managedCheckout() {
    const base = { id: 'managed-checkout', label: 'managed checkout' };
    const state = readJson(path.join(this.#hubPath, 'state.json'));
    if (state.missing) return { ...base, found: false };
    if (state.error) return { ...base, found: true, error: `the update record is ${state.error}` };
    const repoPath = state.value?.repo_path;
    if (typeof repoPath !== 'string' || !repoPath) return { ...base, found: false };
    if (!fs.existsSync(repoPath)) return { ...base, found: true, error: 'its folder is missing' };
    const version = readJson(path.join(repoPath, ...VERSION_REL_PATH.split('/')));
    return { ...base, found: true, gitRoot: this.#isGitCheckout(repoPath) ? repoPath : '', version: SEMVER.test(version.value?.version || '') ? version.value.version : '' };
  }

  #claudeCodePlugin() {
    const base = { id: 'claude-code-plugin', label: 'Claude Code plugin' };
    const install = new ClaudePluginRegistry({ environment: this.#environment, homeDir: this.#homeDir }).toolkitInstall();
    if (!install.installed) {
      if (install.records.length || /could not be read/.test(install.reason)) return { ...base, found: true, error: install.reason };
      return { ...base, found: false };
    }
    const read = this.#pluginVersion(install.runningRoot);
    return { ...base, found: true, gitRoot: this.#isGitCheckout(install.runningRoot) ? install.runningRoot : '', ...read };
  }

  // The Claude desktop app's account copies: each manifest.json that lists the Toolkit plugin.
  #accountCopies() {
    const copies = [];
    for (const folder of claudeAccountPluginFolders(this.#environment)) {
      const manifest = readJson(path.join(folder, 'manifest.json'));
      if (manifest.missing) continue;
      const base = { id: 'claude-account-copy', label: 'claude.ai account copy' };
      if (manifest.error) { copies.push({ ...base, found: true, error: `its manifest is ${manifest.error}` }); continue; }
      for (const plugin of Array.isArray(manifest.value?.plugins) ? manifest.value.plugins : []) {
        if (plugin?.name !== PLUGIN_NAME) continue;
        if (typeof plugin.id !== 'string' || !PLUGIN_ID.test(plugin.id)) { copies.push({ ...base, found: true, error: 'its plugin id is not readable' }); continue; }
        copies.push({ ...base, found: true, ...this.#pluginVersion(path.join(folder, plugin.id)) });
      }
    }
    return copies.length ? copies : [{ id: 'claude-account-copy', label: 'claude.ai account copy', found: false }];
  }

  #syncedCopies() {
    const base = { id: 'cloud-synced-plugin', label: 'cloud synced plugin copy' };
    const synced = path.join(new ClaudePluginRegistry({ environment: this.#environment, homeDir: this.#homeDir }).pluginsDir, 'synced');
    let entries = [];
    try { entries = fs.readdirSync(synced, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
    catch { entries = []; }
    const copies = entries.filter((name) => fs.existsSync(path.join(synced, name, PLUGIN_NAME)))
      .map((name) => ({ ...base, found: true, ...this.#pluginVersion(path.join(synced, name, PLUGIN_NAME)) }));
    return copies.length ? copies : [{ ...base, found: false }];
  }

  #guidebook() {
    const base = { id: 'projects-guidebook', label: 'Projects guidebook' };
    if (!this.#guidebookDir || !fs.existsSync(this.#guidebookDir)) return { ...base, found: false };
    let text;
    try { text = fs.readFileSync(path.join(this.#guidebookDir, 'VERSION'), 'utf8'); }
    catch { return { ...base, found: true, error: 'its VERSION file is missing' }; }
    const line = GUIDEBOOK_LINE.exec(text);
    if (!line) return { ...base, found: true, error: 'its VERSION line is not in the known shape' };
    return { ...base, found: true, mainCommit: line[2], version: line[1] };
  }

  // { commit, min_version, result, copies: [{ id, label, state, detail }] }. target: { commit } or { minVersion }.
  check(target) {
    const copy = target.commit ? this.firstVersion(target.commit) : null;
    const reach = { commit: copy?.merged ? copy.commit : '', minVersion: copy ? copy.version : target.minVersion };
    const found = [this.#managedCheckout(), this.#claudeCodePlugin(), ...this.#accountCopies(), ...this.#syncedCopies(), this.#guidebook()];
    const copies = found.map((entry) => {
      if (!entry.found) return { id: entry.id, label: entry.label, state: STATES.ABSENT, detail: '' };
      if (entry.error) return { id: entry.id, label: entry.label, state: STATES.UNKNOWN, detail: entry.error };
      if (copy && !copy.merged) return { id: entry.id, label: entry.label, state: STATES.UNKNOWN, detail: copy.reason };
      // A guidebook's own version line is the Toolkit version it was copied at; with a commit, its
      // main commit decides.
      const facts = entry.id === 'projects-guidebook' && reach.commit ? { mainCommit: entry.mainCommit } : entry;
      const [state, detail] = this.#judge(facts, reach);
      return { id: entry.id, label: entry.label, state, detail };
    });
    const present = copies.filter((entry) => entry.state !== STATES.ABSENT);
    const result = !present.length ? STATES.UNKNOWN
      : present.some((entry) => entry.state === STATES.NOT) ? STATES.NOT
        : present.some((entry) => entry.state === STATES.UNKNOWN) ? STATES.UNKNOWN : STATES.DELIVERED;
    return { commit: copy ? copy.commit : '', ref: this.#ref, merged: copy ? copy.merged : null, min_version: reach.minVersion || '', result, copies };
  }
}

function parseArgs(argv) {
  const options = { json: false };
  const valued = { '--commit': 'commit', '--min-version': 'minVersion', '--repo': 'repo', '--ref': 'ref', '--hub': 'hub', '--guidebook': 'guidebook' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (valued[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      options[valued[arg]] = value;
      i += 1;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  if (Boolean(options.commit) === Boolean(options.minVersion)) throw new UsageError('give exactly one of --commit <sha> or --min-version <x.y.z>');
  if (options.commit && !COMMIT.test(options.commit)) throw new UsageError('--commit must be a commit id of 7 to 40 hex characters');
  if (options.minVersion && !SEMVER.test(options.minVersion)) throw new UsageError('--min-version must look like 3.135.0');
  return options;
}

function report(result) {
  const lines = [];
  if (result.commit) {
    const short = result.commit.slice(0, 7);
    lines.push(!result.merged ? `Commit ${short} is not on ${result.ref} in this clone.`
      : result.min_version ? `Commit ${short} first shipped in Toolkit ${result.min_version} (${result.ref}).`
        : `Commit ${short} is on ${result.ref} but no Toolkit version holds it yet.`);
  } else lines.push(`Checking for Toolkit ${result.min_version} or later.`);
  lines.push('This host:');
  for (const copy of result.copies) lines.push(`- ${copy.label}: ${WORDS[copy.state]}${copy.detail ? ` (${copy.detail})` : ''}`);
  lines.push(`Result: ${WORDS[result.result]}`);
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr } = {}) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err.write(`${error.message}\nUsage: node repo/scripts/toolkit-release-identity.cjs (--commit <sha> | --min-version <x.y.z>) [--repo <checkout>] [--ref <ref>] [--hub <path>] [--guidebook <folder>] [--json]\n`);
    return 2;
  }
  const checker = new ReleaseIdentityCheck({
    repoRoot: options.repo || ROOT,
    ref: options.ref || DEFAULT_REF,
    hubPath: options.hub,
    guidebookDir: options.guidebook || DEFAULT_GUIDEBOOK,
  });
  const result = checker.check(options.commit ? { commit: options.commit } : { minVersion: options.minVersion });
  out.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : report(result));
  return result.result === STATES.DELIVERED ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ ReleaseIdentityCheck, STATES, main, parseArgs });
