'use strict';

// Isolated GitHub binding observations for test repositories. No laptop answer is written.
// The shared scratch home keeps in-process and spawned hooks away from real user-state.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md');

let scratchHome = null;

// The scratch home this test process uses, created and switched to on first use.
function governedHome() {
  if (scratchHome) return scratchHome;
  scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governed-home-'));
  process.env.HOME = scratchHome;
  process.env.USERPROFILE = scratchHome;
  process.on('exit', () => fs.rmSync(scratchHome, { recursive: true, force: true }));
  return scratchHome;
}

// With `enable: false` nothing is recorded and the process's home is left alone.
function makeGoverned(repo, name, { home, enable = true } = {}) {
  const slug = `toolkit-test-fixture/${name}`;
  fs.mkdirSync(repo, { recursive: true });
  if (enable) require('node:child_process').execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/${slug}.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  fs.copyFileSync(TEMPLATE, path.join(repo, 'AGENTS.md'));
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), `${JSON.stringify({
    schema: 'toolkit.programme-binding.v1', repository: slug, parent_issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX',
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
  }, null, 2)}\n`);
  if (enable) recordEnabled(repo, { home });
  return repo;
}

// Records an existing test repository's binding as a default-branch observation.
function recordEnabled(repo, { home = governedHome() } = {}) {
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  recordMerged(repo, { registryPath });
  return repo;
}

// Writes this computer's cache of the binding merged on the default branch, as a refresh would, from
// the repository's working-tree binding (or `text`), read now.
function recordMerged(repo, { home = null, registryPath = null, text = null, now = new Date() } = {}) {
  if (!registryPath) registryPath = path.join(home || governedHome(), '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const governance = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-state.cjs'));
  const cache = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-binding.cjs'));
  const identity = governance.readIdentity(repo);
  const body = text !== null ? text : fs.readFileSync(path.join(identity.root, '.github', 'toolkit-programme.json'), 'utf8');
  cache.writeCache(path.dirname(registryPath), {
    schema: cache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical, default_branch: 'main',
    commit: '0'.repeat(40), fetched_at: now.toISOString(), status: 'present',
    bytes_sha256: require('node:crypto').createHash('sha256').update(body, 'utf8').digest('hex'), text: body, problem: null,
  });
  return repo;
}

function recordAbsent(repo, { home = governedHome(), registryPath = null } = {}) {
  const governance = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-state.cjs'));
  const cache = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-binding.cjs'));
  const identity = governance.readIdentity(repo);
  cache.writeCache(registryPath ? path.dirname(registryPath) : path.join(home, '.ai-agent-toolkit', 'user-state'), {
    schema: cache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical,
    default_branch: 'main', commit: '0'.repeat(40), fetched_at: new Date().toISOString(), status: 'absent', text: null, bytes_sha256: null, problem: null,
  });
}
module.exports = Object.freeze({ governedHome, makeGoverned, recordEnabled, recordMerged, recordAbsent });
