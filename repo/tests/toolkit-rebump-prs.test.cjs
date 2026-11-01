'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { detectIntent, recoverNotes, mergeJson, safeRef, repositoryFromOrigin, parseArgs } = require('../scripts/toolkit-rebump-prs.cjs');
const { VERSION_REL_PATH } = require('../scripts/toolkit-version.cjs');
const { MANIFEST_REL_PATHS } = require('../scripts/bump-version.cjs');
const { CHANGELOG_REL_PATH, foldFragments, nextVersion, versionProblems } = require('../scripts/toolkit-version-at-merge.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const ROOT = path.resolve(__dirname, '../..');
const NOTES = '### Changed\n\n- Keep the branch change.\n';
const BASE_LOG = '# Toolkit Changelog\n\n## 3.1.0\n\n### Changed\n\n- A released note.\n';
const write = (root, rel, text) => { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { fixture } = require('./support/toolkit-rebump-fixture.cjs');

test('intent is exactly the next patch, minor or major, never a guessed level', () => {
  for (const level of ['patch', 'minor', 'major']) assert.equal(detectIntent('3.1.4', nextVersion('3.1.4', level)), level);
  assert.equal(detectIntent('3.1.4', '3.1.4'), '');
  for (const version of ['3.1.6', '3.3.0', '2.0.0', '5.0.0', 'bad', undefined]) assert.throws(() => detectIntent('3.1.4', version));
});

test('refs and repository identity refuse option injection, paths and hostile text', () => {
  assert.equal(safeRef('claude/branch-1'), 'claude/branch-1');
  for (const ref of ['--upload-pack=x', '../main', 'a..b', '/main', 'a.lock', 'a//b', 'a\\b', 'a@{x}', 'a.', 'a/']) assert.throws(() => safeRef(ref));
  hostile.expectDefaultDeny(assert, text => { try { safeRef(text); return true; } catch { return false; } }, hostile.cases(['invisible', 'line-breaks']));
  assert.equal(repositoryFromOrigin('git@github.com:example/toolkit.git'), 'example/toolkit');
  assert.equal(repositoryFromOrigin('https://github.com/example/toolkit.git'), 'example/toolkit');
  for (const origin of ['https://token@github.com/example/toolkit', 'https://example.com/a/b', '/local/path']) assert.throws(() => repositoryFromOrigin(origin));
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.throws(() => parseArgs(['--force']));
});

test('JSON fields merge independently while conflicting edits and deletions hold', () => {
  const result = mergeJson({ name: 'fixture', nested: { keep: true }, removed: true },
    { name: 'fixture', nested: { keep: true, branch: true } },
    { name: 'fixture', nested: { keep: true, main: true }, removed: true });
  assert.equal(result.nested.branch, true); assert.equal(result.nested.main, true);
  assert.equal(Object.hasOwn(result, 'removed'), false);
  assert.throws(() => mergeJson({ name: 'base' }, { name: 'branch' }, { name: 'main' }), /non-version/);
  assert.throws(() => mergeJson({ field: 'base' }, {}, { field: 'main' }), /non-version/);
});

test('release recovery preserves frozen bodies and refuses duplicate or inherited notes', () => {
  const head = foldFragments(BASE_LOG, '3.2.0', [{ title: 'branch change', body: NOTES.trim() }]);
  assert.equal(recoverNotes(BASE_LOG, head, '3.2.0'), `Title: branch change\n\n${NOTES}`);
  assert.throws(() => recoverNotes(BASE_LOG, head.replace('A released note', 'Edited history'), '3.2.0'), /byte for byte/);
  assert.throws(() => recoverNotes(BASE_LOG, head + '\n## 3.1.0\n', '3.2.0'), /duplicate/);
  assert.throws(() => recoverNotes(BASE_LOG.replace('## 3.1.0', '## Unreleased'), head, '3.2.0'), /Unreleased/);
});

for (const level of ['patch', 'minor']) {
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
    assert.deepEqual(f.git(clone, 'log', '-2', '--format=%an <%ae>|%cn <%ce>').split('\n'),
      Array(2).fill('Release test <release@example.com>|Release test <release@example.com>'));
    assert.doesNotMatch(f.git(clone, 'log', '-2', '--format=%B'), /Co-Authored-By|Generated[ -]with|session|\bAI\b/i);
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

test('missing configured identity holds with a Git failure and never pushes', t => {
  const f = fixture(t); const head = f.pr().head.sha;
  let failure, pushes = 0;
  const result = f.operation(true, { git: (cwd, args) => {
    if (args[0] === 'push') pushes += 1;
    const response = f.raw(cwd, args);
    if (args[0] === 'clone' && response.status === 0) {
      const clone = args.at(-1);
      f.git(clone, 'config', 'user.useConfigOnly', 'true');
      f.git(clone, 'config', 'user.name', '');
      f.git(clone, 'config', 'user.email', '');
    }
    if (['merge', 'commit'].includes(args[0]) && response.status !== 0) failure = response;
    return response;
  } }).process(f.pr());
  assert.equal(result.status, 'held'); assert.match(result.reason, /merge failed|commit failed/);
  assert.ok(failure); assert.match(failure.stderr, /identity|ident|user\.name|user\.email/i);
  assert.equal(pushes, 0); assert.equal(f.pr().head.sha, head);
});

test('report discovery verifies origin and account, pages PRs and executes no mutating git command', t => {
  const f = fixture(t); const commands = [], pages = [];
  const op = f.operation(false, {
    git: (cwd, args) => { commands.push(args[0]); return args[0] === 'remote' ? { status: 0, stdout: 'https://github.com/example/toolkit.git\n' } : f.raw(cwd, args); },
    github: args => {
      if (args[0] === 'auth') return '';
      if (args[1] === 'user') return JSON.stringify({ login: 'release-test' });
      pages.push(args[1]);
      const current = f.pr();
      return JSON.stringify(pages.length === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...current, number: i + 1, draft: true })) : [current]);
    },
  });
  const result = op.run();
  assert.equal(result.results.length, 101); assert.equal(pages.length, 2);
  assert.ok(commands.every(command => ['remote', 'ls-remote', 'merge-base', 'show'].includes(command)), commands.join(','));
  f.git(f.repo, 'branch', 'other'); f.git(f.repo, 'push', '-q', 'origin', 'other');
  const first = f.operation(false).process(f.pr());
  const second = f.operation(false).process({ ...f.pr(), number: 8, head: { ...f.pr().head, ref: 'other' } });
  assert.equal(first.status, 'eligible'); assert.equal(second.status, 'eligible');
  assert.equal(first.target, second.target, 'proposed versions are not reserved between PRs');
});
