'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The repo update owns the commit it fetches: each case pins one fetch target, keeps that target across
// credential retries, moves HEAD only to the checked commit, and removes the fetch ref it created (or
// warns with its name when that cleanup fails), whether the fetch, ancestry, merge or cleanup step fails.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { fetchFixture, foreignFetch, loadWithCommands } = require('./support/toolkit-fetch-race-fixture.cjs');
const { git, writeFile, commitAll, currentCommit } = require('./support/toolkit-local-bridge-fixture.cjs');

for (const mode of ['after-fetch', 'after-ancestry', 'credential-fallback', 'fetch-failure', 'ancestry-failure', 'merge-failure', 'cleanup-failure', 'cleanup-fetch-failure', 'credential-failure-no-refs']) {
  test(`repo update owns its fetched commit: ${mode}`, () => {
    const noRefs = mode === 'credential-failure-no-refs';
    const cleanupFailure = mode.startsWith('cleanup-');
    const fixture = fetchFixture({ foreignRef: !noRefs });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);
    try {
      if (noRefs) assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'refs', 'toolkit')), false);
      if (mode === 'ancestry-failure') {
        writeFile(path.join(fixture.repo, 'local.txt'), 'local divergence\n');
        commitAll(fixture.repo, 'local divergence');
      }
      const before = currentCommit(fixture.repo);
      const fetchRefs = [];
      let injected = false;
      let ancestryTarget;
      let mergeTarget;
      const fetchArgs = [];
      const invoke = (program, args, options) => {
        if (!/^git(?:\.exe)?$/i.test(path.basename(program))) return spawnSync(program, args, options);
        const fetch = args.includes('fetch');
        if (fetch) {
          fetchArgs.push(args);
          fetchRefs.push(args.at(-1));
          if (noRefs || mode === 'cleanup-fetch-failure') return { status: 1, stdout: '', stderr: 'could not read Username' };
          if (mode === 'fetch-failure') return spawnSync(program, ['fetch', 'origin', 'refs/heads/missing'], options);
          if (mode === 'credential-fallback' && fetchRefs.length === 1) return { status: 1, stdout: '', stderr: 'could not read Username' };
        }
        if (cleanupFailure && args[0] === 'update-ref' && args[1] === '-d') return { status: 1, stdout: '', stderr: 'injected cleanup failure' };
        if (args[0] === 'merge') {
          mergeTarget = args.at(-1);
          if (mode === 'merge-failure') return { status: 1, stdout: '', stderr: 'injected merge failure' };
        }
        if (args[0] === 'merge-base') ancestryTarget = args.at(-1);
        const result = spawnSync(program, args, options);
        const atFetch = fetch && result.status === 0 && mode !== 'after-ancestry';
        const atAncestry = args[0] === 'merge-base' && mode === 'after-ancestry';
        if (!injected && (atFetch || atAncestry)) { foreignFetch(fixture); injected = true; }
        return result;
      };
      const bridge = loadWithCommands('toolkit-local-bridge.cjs', ['validateAndUpdateRepo'], invoke, fixture.root);
      const update = () => bridge.validateAndUpdateRepo({ repo_path: fixture.repo, repo_remote: fixture.origin, repo_branch: 'main' }, { hook: true });
      if (noRefs || (mode.endsWith('failure') && mode !== 'cleanup-failure')) {
        assert.throws(update, noRefs || mode === 'cleanup-fetch-failure' ? /git fetch origin main failed:[\s\S]*Credential hint/ : mode === 'fetch-failure' ? /git fetch origin main failed/ : mode === 'ancestry-failure' ? /not a fast-forward/ : /fast-forward|git merge/);
        assert.equal(currentCommit(fixture.repo), before, 'failure must not update HEAD');
      } else {
        const result = update();
        assert.equal(result.toCommit, fixture.intended);
        assert.equal(result.status, 'updated');
        assert.ok(result.validation, 'validation still runs after cleanup fails');
        assert.equal(currentCommit(fixture.repo), fixture.intended);
        assert.equal(ancestryTarget, fixture.intended, 'ancestry checks the intended SHA');
        assert.equal(mergeTarget, fixture.intended, 'merge uses the immutable checked SHA');
        assert.equal(git(fixture.repo, ['rev-parse', 'FETCH_HEAD']), fixture.foreign);
      }
      assert.equal(new Set(fetchRefs).size, 1, 'credential retries keep the same target');
      assert.match(fetchRefs[0], /^main:refs\/toolkit\/fetch\/\d+-[a-f0-9]+$/);
      const ownedRef = fetchRefs[0].slice('main:'.length);
      if (!noRefs) assert.equal(git(fixture.repo, ['rev-parse', 'refs/toolkit/fetch/foreign-owner']), injected ? fixture.foreign : fixture.initialCommit);
      const remaining = noRefs ? [] : ['refs/toolkit/fetch/foreign-owner'];
      if (mode === 'cleanup-failure') remaining.push(ownedRef);
      assert.deepEqual(git(fixture.repo, ['for-each-ref', '--format=%(refname)', 'refs/toolkit/fetch/']).split('\n').filter(Boolean).sort(), remaining.sort());
      if (cleanupFailure) {
        assert.match(warnings.join('\n'), /warning.*owned fetch ref/i);
        assert.ok(warnings.join('\n').includes(ownedRef));
      } else assert.deepEqual(warnings, []);
      for (const args of fetchArgs) assert.ok(args.includes('--no-tags'), 'owned fetch does not follow tags');
      assert.equal(git(fixture.repo, ['status', '--porcelain']), '');
    } finally {
      console.warn = originalWarn;
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
