'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture } = require('./support/toolkit-rebump-fixture.cjs');
const write = (root, rel, text) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('validation failure, stale main and stale PR head each prevent a push', t => {
  const f = fixture(t);
  const original = f.pr().head.sha;
  const failed = f.operation(true, { validate: () => { throw new Error('validation refused'); } }).process(f.pr());
  assert.match(failed.reason, /validation refused/); assert.equal(f.pr().head.sha, original);
  const stale = f.operation(true, { github: () => { f.mainRelease('3.1.2'); return JSON.stringify(f.pr()); } }).process(f.pr());
  assert.match(stale.reason, /changed before push/); assert.equal(f.pr().head.sha, original);
  const moved = f.operation(true, { github: () => { f.editLane(() => write(f.repo, 'later.txt', 'later\n')); return JSON.stringify(f.pr()); } }).process(f.pr());
  assert.match(moved.reason, /changed before push/);
});

test('an uncertain successful push is reconciled by read-back and never repeated', t => {
  const f = fixture(t); let pushes = 0;
  const result = f.operation(true, { git: (cwd, args) => {
    const response = f.raw(cwd, args);
    if (args[0] === 'push') { pushes += 1; return { ...response, status: 1 }; }
    return response;
  } }).process(f.pr());
  assert.equal(result.status, 'verified', JSON.stringify(result)); assert.equal(pushes, 1);
  assert.equal(f.operation().process(f.pr()).status, 'unchanged');
});

test('ordinary push refuses a competing branch advance after the final read', t => {
  const f = fixture(t); let competing;
  const result = f.operation(true, { git: (cwd, args) => {
    if (args[0] === 'push') competing = f.editLane(() => write(f.repo, 'competing.txt', 'writer\n'));
    return f.raw(cwd, args);
  } }).process(f.pr());
  assert.equal(result.status, 'held'); assert.match(result.reason, /push failed or uncertain/);
  assert.equal(f.pr().head.sha, competing);
});


test('generation failure and symlink trees never reach a push', t => {
  const f = fixture(t);
  const head = f.pr().head.sha;
  const failed = f.operation(true, { generate: () => { throw new Error('generator refused'); } }).process(f.pr());
  assert.match(failed.reason, /generator refused/); assert.equal(f.pr().head.sha, head);
  const blob = f.git(f.repo, 'rev-parse', 'HEAD:source.txt');
  f.git(f.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},linked.txt`);
  // Commit the index directly: no Windows symlink permission is needed.
  f.git(f.repo, 'commit', '-q', '-m', 'link fixture'); f.git(f.repo, 'push', '-q', 'origin', 'lane');
  const linkHead = f.pr().head.sha;
  const linked = f.operation().process(f.pr());
  assert.equal(linked.status, 'held'); assert.match(linked.reason, /symlinks/);
  assert.equal(f.pr().head.sha, linkHead);
});

