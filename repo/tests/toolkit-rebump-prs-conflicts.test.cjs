'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { MANIFEST_REL_PATHS } = require('../scripts/bump-version.cjs');
const { CHANGELOG_REL_PATH, nextVersion } = require('../scripts/toolkit-version-at-merge.cjs');
const write = (root, rel, text) => { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { fixture } = require('./support/toolkit-rebump-fixture.cjs');


for (const level of ['major']) {
  test(`${level} is preserved across repeated main moves with ordinary merge parents and push`, t => {
    const f = fixture(t, level);
    const before = f.git(f.repo, 'status', '--porcelain');
    const report = f.operation(false).process(f.pr());
    assert.equal(report.status, 'eligible', JSON.stringify(report));
    assert.equal(f.git(f.repo, 'status', '--porcelain'), before);
    const oldHead = f.pr().head.sha;
    const first = f.operation().process(f.pr());
    assert.equal(first.status, 'verified', JSON.stringify(first));
    assert.equal(first.version, nextVersion('3.1.1', level));
    const scratch = path.join(f.repo, '.tmp');
    const clone = path.join(scratch, fs.readdirSync(scratch).find(name => name.startsWith('rebump-')));
    assert.equal(f.git(clone, 'show', '-s', '--format=%P', 'HEAD~1'), `${oldHead} ${f.main}`);
    assert.equal(f.git(clone, 'merge-base', '--is-ancestor', oldHead, first.head), '');
    assert.doesNotMatch(f.git(clone, 'log', '-2', '--format=%B'), /Co-Authored-By|Generated with|session|\bAI\b/i);
    assert.equal(f.operation().process(f.pr()).status, 'unchanged');
    f.mainRelease(level === 'major' ? '4.1.0' : '3.2.0');
    const second = f.operation().process(f.pr());
    assert.equal(second.status, 'verified', JSON.stringify(second));
    assert.equal(second.level, level);
    assert.equal(second.version, nextVersion(level === 'major' ? '4.1.0' : '3.2.0', level));
    assert.equal(read(f.repo, 'branch.txt'), 'branch change\n', 'caller branch stays untouched');
    assert.equal(f.git(f.repo, 'status', '--porcelain'), before);
  });
}

test('no-bump branches, drafts, forks, closed and non-main PRs are skipped', t => {
  const f = fixture(t, '');
  assert.equal(f.operation().process(f.pr()).reason, 'no version bump');
  const pr = f.pr();
  for (const value of [{ ...pr, draft: true }, { ...pr, state: 'closed' }, { ...pr, head: { ...pr.head, repo: { full_name: 'example/fork' } } }, { ...pr, base: { ...pr.base, ref: 'develop' } }]) {
    assert.equal(f.operation().process(value).status, 'skipped');
  }
  assert.equal(f.operation().process({ ...pr, auto_merge: {} }).status, 'held');
});

test('source conflicts abort scratch merge and never change the branch', t => {
  const f = fixture(t);
  f.editLane(() => write(f.repo, 'source.txt', 'branch conflict\n'));
  f.git(f.repo, 'checkout', '-q', 'main');
  write(f.repo, 'source.txt', 'main conflict\n');
  f.commit('main source'); f.git(f.repo, 'push', '-q', 'origin', 'main');
  f.git(f.repo, 'checkout', '-q', 'lane');
  const head = f.pr().head.sha;
  const result = f.operation().process(f.pr());
  assert.equal(result.status, 'held'); assert.match(result.reason, /source conflict/);
  assert.equal(f.pr().head.sha, head);
  assert.equal(fs.existsSync(path.join(result.scratch, '.git/MERGE_HEAD')), false);
});

test('mechanical version conflicts preserve independent manifest fields from both sides', t => {
  const f = fixture(t);
  f.editLane(() => { const value = JSON.parse(read(f.repo, MANIFEST_REL_PATHS[0])); value.branchField = 'keep'; write(f.repo, MANIFEST_REL_PATHS[0], JSON.stringify(value, null, 2) + '\n'); });
  f.git(f.repo, 'checkout', '-q', 'main');
  const value = JSON.parse(read(f.repo, MANIFEST_REL_PATHS[0])); value.mainField = 'keep';
  write(f.repo, MANIFEST_REL_PATHS[0], JSON.stringify(value, null, 2) + '\n');
  f.commit('main manifest'); f.git(f.repo, 'push', '-q', 'origin', 'main'); f.git(f.repo, 'checkout', '-q', 'lane');
  const result = f.operation().process(f.pr());
  assert.equal(result.status, 'verified', JSON.stringify(result));
  f.git(f.repo, 'fetch', '-q', 'origin', 'lane');
  const merged = JSON.parse(f.git(f.repo, 'show', `FETCH_HEAD:${MANIFEST_REL_PATHS[0]}`));
  assert.equal(merged.branchField, 'keep'); assert.equal(merged.mainField, 'keep');
});

test('non-version manifest conflicts and edited frozen notes hold without push', t => {
  const f = fixture(t);
  f.editLane(() => write(f.repo, CHANGELOG_REL_PATH, read(f.repo, CHANGELOG_REL_PATH).replace('A released note', 'An edited note')));
  const head = f.pr().head.sha;
  assert.match(f.operation().process(f.pr()).reason, /byte for byte/);
  assert.equal(f.pr().head.sha, head);
  assert.throws(() => f.operation().mergeText(f.repo, 'source.txt', f.base, head, f.main), /source conflict/);
  f.editLane(() => {
    write(f.repo, CHANGELOG_REL_PATH, read(f.repo, CHANGELOG_REL_PATH).replace('An edited note', 'A released note'));
    const value = JSON.parse(read(f.repo, MANIFEST_REL_PATHS[0])); value.name = 'branch name';
    write(f.repo, MANIFEST_REL_PATHS[0], JSON.stringify(value, null, 2) + '\n');
  });
  f.git(f.repo, 'checkout', '-q', 'main');
  const value = JSON.parse(read(f.repo, MANIFEST_REL_PATHS[0])); value.name = 'main name';
  write(f.repo, MANIFEST_REL_PATHS[0], JSON.stringify(value, null, 2) + '\n');
  f.commit('main name'); f.git(f.repo, 'push', '-q', 'origin', 'main'); f.git(f.repo, 'checkout', '-q', 'lane');
  const conflict = f.operation().process(f.pr());
  assert.equal(conflict.status, 'held'); assert.match(conflict.reason, /conflicting non-version/);
});
