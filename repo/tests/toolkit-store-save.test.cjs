'use strict';

// toolkit store save: scans exactly what it commits and pushes only the bound branch.
// Real Git against a local bare repository; only the GitHub read, the binding read and the reported
// remote address are faked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const store = require('../scripts/toolkit-store.cjs');
const { PLANTED, git, pushes, world } = require('./support/toolkit-store-world.cjs');

test('save commits only the named new files, scans them, pushes the bound branch and reads it back', t => {
  const w = world(t);
  w.write('archives/868/report.md', 'G0 report\n');
  w.write('archives/868/other.md', 'not named\n');
  const { code, result } = w.act(['save', '--path', 'archives/868/report.md', '--message', 'archive 868 report']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.read_back, true);
  assert.equal(result.files, 1);
  assert.ok(w.remoteHas('archives/868/report.md'));
  assert.ok(!w.remoteHas('archives/868/other.md'), 'an unnamed file is never committed');
  assert.equal(git(w.dir, 'log', '-1', '--format=%s'), 'archive 868 report');
  assert.deepEqual(pushes(w.calls), [['push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main']]);
  assert.deepEqual(fs.readdirSync(w.tmp), [], 'the empty hooks folder is removed');
});

test('a planted secret, an unreadable large file or a path outside the store folders commits nothing', t => {
  const w = world(t);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  w.write('archives/x/leak.md', `token = ${PLANTED}\n`);
  let run = w.act(['save', '--path', 'archives/x', '--message', 'leak']);
  assert.equal(run.code, 1);
  assert.match(run.result.stopped, /secret scan found 1 match\(es\): archives\/x\/leak\.md:1 \(github-token\)/);
  assert.ok(!run.result.stopped.includes(PLANTED), 'the finding never prints the secret');
  fs.rmSync(path.join(w.dir, 'archives', 'x'), { recursive: true });

  w.write('evidence/big.log', 'a'.repeat(5 * 1024 * 1024 + 1));
  run = w.act(['save', '--path', 'evidence/big.log', '--message', 'big']);
  assert.match(run.result.stopped, /could not be scanned \(over 5 MB, binary or not UTF-8\): evidence\/big\.log/);
  fs.rmSync(path.join(w.dir, 'evidence'), { recursive: true });

  w.write('elsewhere/x.md', 'x\n');
  assert.match(w.act(['save', '--path', 'elsewhere/x.md', '--message', 'x']).result.stopped, /outside the store folders this command writes \(state\/owner\/repo\/, archives\/, evidence\/\)/);
  w.write('state/owner/repo/doc.md', 'doc\n');
  for (const bad of ['../x', 'archives/../x', '.git/config', 'archives/.GIT/x', '/abs', '-x', 'archives/*', 'archives/x?']) {
    assert.equal(store.storePath(bad), null, bad);
  }
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(w.dir, 'diff', '--cached', '--name-only'), '', 'nothing is left staged after a refusal');
  assert.deepEqual(pushes(w.calls), []);
  assert.equal(w.act(['save', '--path', 'state/owner/repo/doc.md', '--message', 'doc']).code, 0, 'the binding store path is writable');
});

test('save never stages a deletion and never pushes a local commit that fails the checks', t => {
  const w = world(t);
  fs.rmSync(path.join(w.dir, 'archives', 'old', 'kept.md'));
  w.write('archives/old/new.md', 'new\n');
  assert.equal(w.act(['save', '--path', 'archives/old', '--message', 'folder']).code, 0);
  assert.ok(w.remoteHas('archives/old/kept.md'), 'the deleted file stays in the store');
  assert.ok(w.remoteHas('archives/old/new.md'));

  git(w.dir, 'checkout', '--quiet', '--', 'archives/old/kept.md');
  w.write('loose.json', '{"raw":true}\n');
  git(w.dir, 'commit', '--quiet', '-am', 'raw commit');
  w.write('archives/after.md', 'after\n');
  const run = w.act(['save', '--path', 'archives/after.md', '--message', 'after']);
  assert.match(run.result.stopped, /^commit [0-9a-f]{7}: loose\.json is outside the store folders this command writes/);
  assert.ok(!w.remoteHas('archives/after.md') && !w.remoteHas('archives/old/after.md'));
  assert.equal(git(w.dir, 'diff', '--cached', '--name-only'), '', 'nothing is staged by the refused run');
});

test('a store that moved during the push is merged in once with a merge commit, then pushed', t => {
  const w = world(t);
  w.hooks.beforePush = () => {
    fs.writeFileSync(path.join(w.other, 'loose-2.json'), '{}\n');
    git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'raced'); git(w.other, 'push', '--quiet', 'origin', 'main');
  };
  w.write('archives/race.md', 'race\n');
  const { code, result } = w.act(['save', '--path', 'archives/race.md', '--message', 'race']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.merged_remote, true);
  assert.ok(w.remoteHas('archives/race.md') && w.remoteHas('loose-2.json'));
  assert.equal(git(w.dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'a merge commit, never a rebase');
});

test('a file the scan cannot read as text (gzip, UTF-16) is refused', t => {
  const w = world(t);
  fs.mkdirSync(path.join(w.dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(w.dir, 'evidence', 'logs.gz'), zlib.gzipSync(`token = ${PLANTED}\n`));
  assert.match(w.act(['save', '--path', 'evidence/logs.gz', '--message', 'gz']).result.stopped, /could not be scanned \(over 5 MB, binary or not UTF-8\): evidence\/logs\.gz/);
  fs.rmSync(path.join(w.dir, 'evidence', 'logs.gz'));
  fs.writeFileSync(path.join(w.dir, 'evidence', 'u16.txt'), Buffer.from(`token = ${PLANTED}\n`, 'utf16le'));
  assert.match(w.act(['save', '--path', 'evidence/u16.txt', '--message', 'u16']).result.stopped, /evidence\/u16\.txt/);
  assert.ok(!w.remoteHas('evidence/logs.gz') && !w.remoteHas('evidence/u16.txt'));
  assert.deepEqual(pushes(w.calls), []);
});
