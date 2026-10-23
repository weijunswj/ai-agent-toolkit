'use strict';

// Test support: turns a scratch folder into a repository the governance state reads as ENABLED by
// repository opt-in (rule R4): an origin remote in .git/config, the Toolkit-governed rules block in
// AGENTS.md and a valid `.github/toolkit-programme.json`. The remote names a fixture owner, so no
// real decision in the user's registry can apply to it.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(ROOT, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md');

function makeGoverned(repo, name) {
  const slug = `toolkit-test-fixture/${name}`;
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/${slug}.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  fs.copyFileSync(TEMPLATE, path.join(repo, 'AGENTS.md'));
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), `${JSON.stringify({
    schema: 'toolkit.programme-binding.v1', repository: slug, parent_issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX',
    store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
  }, null, 2)}\n`);
  return repo;
}

module.exports = Object.freeze({ makeGoverned });
