'use strict';

// Test support: turns a scratch folder into a repository the governance state reads as ENABLED with
// the governed rules in force (rule R3): an origin remote in .git/config, the Toolkit-governed rules
// block in AGENTS.md, a valid `.github/toolkit-programme.json`, and the user's recorded yes. The
// block and binding alone are not the user's answer, so the yes is recorded in a scratch home: the
// first yes recorded without a `home` points this test process (HOME, USERPROFILE) at one, so the
// hooks it runs, in process or as child processes, read that registry and never the real user's.
// Pass `home` to record into a home a test already uses for its child processes. The remote names a
// fixture owner.

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

// Records the user's yes for an existing repository (such as the Toolkit checkout itself) in the
// scratch home.
function recordEnabled(repo, { home = governedHome() } = {}) {
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-gate.cjs')).writeGovernanceDecision(repo, 'enable', { registryOptions: { registryPath, testOnly: true } });
  return repo;
}

module.exports = Object.freeze({ governedHome, makeGoverned, recordEnabled });
