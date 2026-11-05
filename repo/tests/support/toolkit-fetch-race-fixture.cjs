'use strict';

// Real local Git operations, with a process boundary at which another fetch can run.
// Loading private functions here avoids adding test-only exports to runtime scripts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const childProcess = require('node:child_process');
const { createRepoAutoUpdateFixture, git, writeFile, commitAll } = require('./toolkit-local-bridge-fixture.cjs');

function fetchFixture({ foreignRef = true } = {}) {
  const fixture = createRepoAutoUpdateFixture();
  writeFile(path.join(fixture.upstream, 'intended.txt'), 'intended update\n');
  fixture.intended = commitAll(fixture.upstream, 'intended update');
  git(fixture.upstream, ['push', 'origin', 'main']);
  writeFile(path.join(fixture.upstream, 'foreign.txt'), 'foreign update\n');
  fixture.foreign = commitAll(fixture.upstream, 'foreign descendant');
  git(fixture.upstream, ['push', 'origin', 'HEAD:refs/heads/foreign']);
  if (foreignRef) git(fixture.repo, ['update-ref', 'refs/toolkit/fetch/foreign-owner', fixture.initialCommit]);
  return fixture;
}

function loadWithCommands(script, names, spawnSync, tempRoot) {
  const filename = path.resolve(__dirname, '../../scripts', script);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const requireWithCommands = (name) => {
    if (name === 'node:child_process') return { ...childProcess, spawnSync };
    if (name === 'node:os') return { ...require('node:os'), tmpdir: () => tempRoot };
    return localRequire(name);
  };
  const source = `${fs.readFileSync(filename, 'utf8').replace(/^#![^\n]*\n/, '')}\nmodule.exports = { ${names.join(', ')} };`;
  const wrapper = vm.runInThisContext(`(function(require, module, exports, __filename, __dirname) {${source}\n})`, { filename });
  wrapper(requireWithCommands, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function foreignFetch(fixture) {
  git(fixture.repo, ['fetch', 'origin', 'foreign:refs/toolkit/fetch/foreign-owner']);
}

module.exports = { fetchFixture, foreignFetch, loadWithCommands };
