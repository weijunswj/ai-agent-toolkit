'use strict';

// toolkit store history: no step deletes a file, rewrites history or force-pushes.
// Real Git against a local bare repository; only the GitHub read, the binding read and the reported
// remote address are faked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { git, commitIn, pushes, world } = require('./support/toolkit-store-world.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

test('no step ever force-pushes, mirrors, rewrites or pushes a branch but the bound one', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'done', 'origin/main'); git(w.other, 'push', '--quiet', 'origin', 'done');
  w.write('archives/s.md', 's\n');
  w.act(['save', '--path', 'archives/s.md', '--message', 's']);
  w.act(['move', '--from', 'archives/s.md', '--to', 'archives/t.md', '--message', 't']);
  w.act(['delete-merged-branch', '--branch', 'done']);
  const all = pushes(w.calls);
  assert.ok(all.length >= 3);
  for (const args of all) {
    const deleting = args.includes('--delete');
    assert.ok(!args.some(word => /^(?:--force|-f|--mirror|--all|--prune|--tags)$/.test(word) || /^\+/.test(word) || /^:/.test(word)), args.join(' '));
    if (deleting) assert.deepEqual(args, ['push', '--quiet', `--force-with-lease=refs/heads/done:${git(w.other, 'rev-parse', 'done')}`, 'origin', '--delete', 'refs/heads/done']);
    else assert.deepEqual(args, ['push', '--quiet', 'origin', 'refs/heads/main:refs/heads/main']);
  }
  assert.ok(!w.calls.some(args => /^(?:rebase|filter-branch|update-ref)$/.test(args[0]) || (args[0] === 'commit' && args.includes('--amend'))));
  // The only reset is the one that unstages a refused save: index only, no ref, no mode flag.
  const source = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-store.cjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/\[\s*'reset'[^\]]*\]/g)].map(match => match[0]), ["['reset', '--quiet']", "['reset', '--quiet']"]);
  assert.ok(w.calls.filter(args => args[0] === 'reset').every(args => args.length === 2 && args[1] === '--quiet'));
});

// The store's deletion rule has no exception: save, move and merge-branch never delete a file, and a
// deletion in a staged change, a commit the remote lacks or a merge is refused. A file in the retired
// handoff snapshot's memory area, with that folder's manifest listing it as removed (either manifest
// version), is refused like any other file.
test('every deletion is refused by save, move and merge-branch, a retired snapshot memory file included', t => {
  const w = world(t);
  const SNAPSHOT = 'evidence/handoff/owner/repo';
  const manifest = (schema, removed) => `${JSON.stringify({ schema, files: [], removed: removed ? [{ path: 'memory/note.md', removed_at: '2026-11-21T18:07:00.000Z' }] : [] }, null, 2)}\n`;
  git(w.other, 'pull', '--quiet', '--no-rebase', 'origin', 'main');
  fs.mkdirSync(path.join(w.other, ...SNAPSHOT.split('/'), 'memory'), { recursive: true });
  fs.writeFileSync(path.join(w.other, ...SNAPSHOT.split('/'), 'memory', 'note.md'), 'note\n');
  fs.writeFileSync(path.join(w.other, ...SNAPSHOT.split('/'), 'manifest.json'), manifest('toolkit.handoff-snapshot.v2', false));
  git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'old snapshot'); git(w.other, 'push', '--quiet', 'origin', 'main');
  git(w.dir, 'pull', '--quiet', '--ff-only', 'origin', 'main');
  const seeded = w.remoteTip();
  // One deletion, as a commit in `dir` (the checkout) or `other` (a store branch).
  const deletions = {
    plain: dir => { fs.rmSync(path.join(dir, 'archives', 'old', 'kept.md')); return 'archives/old/kept.md'; },
    'snapshot v1': dir => { fs.rmSync(path.join(dir, ...SNAPSHOT.split('/'), 'memory', 'note.md')); fs.writeFileSync(path.join(dir, ...SNAPSHOT.split('/'), 'manifest.json'), manifest('toolkit.handoff-snapshot.v1', true)); return `${SNAPSHOT}/memory/note.md`; },
    'snapshot v2': dir => { fs.rmSync(path.join(dir, ...SNAPSHOT.split('/'), 'memory', 'note.md')); fs.writeFileSync(path.join(dir, ...SNAPSHOT.split('/'), 'manifest.json'), manifest('toolkit.handoff-snapshot.v2', true)); return `${SNAPSHOT}/memory/note.md`; },
  };
  const commands = {
    save: () => { w.write('archives/after.md', 'after\n'); return ['save', '--path', 'archives/after.md', '--message', 'after']; },
    move: () => ['move', '--from', 'loose.json', '--to', 'archives/loose/loose.json', '--message', 'tidy'],
    'merge-branch': () => ['merge-branch', '--branch', 'drop', '--message', 'merge drop'],
  };
  for (const [command, argv] of Object.entries(commands)) {
    for (const [kind, remove] of Object.entries(deletions)) {
      const label = `${command} / ${kind}`;
      let file;
      if (command === 'merge-branch') {
        git(w.other, 'checkout', '--quiet', '-B', 'drop', 'origin/main');
        file = remove(w.other);
        git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'drop'); git(w.other, 'push', '--quiet', '--force', 'origin', 'drop');
        git(w.other, 'checkout', '--quiet', 'main');
      } else {
        file = remove(w.dir);
        git(w.dir, 'add', '-A'); git(w.dir, 'commit', '--quiet', '-m', 'drop');
      }
      const run = w.act(argv());
      assert.equal(run.code, 1, `${label}: ${JSON.stringify(run.result)}`);
      assert.ok(run.result.stopped.includes(`${file} would be deleted or changed away`), `${label}: ${run.result.stopped}`);
      assert.equal(w.remoteTip(), seeded, `${label}: nothing reaches the store`);
      assert.ok(w.remoteHas(file), `${label}: the file stays in the store`);
      assert.ok(!fs.existsSync(path.join(w.dir, '.git', 'MERGE_HEAD')), `${label}: no half-done merge`);
      git(w.dir, 'reset', '--quiet', '--hard', 'origin/main');
      fs.rmSync(path.join(w.dir, 'archives', 'after.md'), { force: true });
    }
  }
});

test('a graft in the store checkout cannot make an unmerged branch look merged, and the merged check is GitHub\'s', t => {
  const w = world(t);
  git(w.other, 'checkout', '--quiet', '-B', 'only-copy', 'origin/main');
  commitIn(w.other, 'only.md', 'only copy\n', 'only');
  git(w.other, 'push', '--quiet', 'origin', 'only-copy');
  const tip = git(w.other, 'rev-parse', 'HEAD');
  git(w.dir, 'fetch', '--quiet', 'origin', 'only-copy');
  fs.writeFileSync(path.join(w.dir, '.git', 'info', 'grafts'), `${git(w.dir, 'rev-parse', 'origin/main')} ${tip}\n`);
  const run = w.act(['delete-merged-branch', '--branch', 'only-copy']);
  assert.equal(run.code, 1, JSON.stringify(run.result));
  assert.match(run.result.stopped, /has commits that are not in main/);
  assert.notEqual(git(w.remote, 'branch', '--list', 'only-copy'), '', 'the only copy is still on the store');
  // Every Git call runs with grafts pointed at a missing file and the commit-graph off.
  assert.ok(w.calls.env.GIT_GRAFT_FILE && !fs.existsSync(w.calls.env.GIT_GRAFT_FILE));
});

test('a graft cannot turn a save into a history rewrite, and the read-back checks the old tip on GitHub', t => {
  const w = world(t);
  const tip = git(w.dir, 'rev-parse', 'origin/main');
  git(w.dir, 'checkout', '--quiet', '--orphan', 'tmpx');
  git(w.dir, 'rm', '-rq', '--cached', '.');
  fs.rmSync(path.join(w.dir, 'archives'), { recursive: true, force: true }); fs.rmSync(path.join(w.dir, 'loose.json'), { force: true });
  commitIn(w.dir, 'archives/rewritten.md', 'history replaced\n', 'orphan');
  const orphan = git(w.dir, 'rev-parse', 'HEAD');
  git(w.dir, 'branch', '-f', 'main', orphan); git(w.dir, 'checkout', '--quiet', 'main'); git(w.dir, 'branch', '-D', 'tmpx');
  fs.writeFileSync(path.join(w.dir, '.git', 'info', 'grafts'), `${orphan} ${tip}\n`);
  w.write('archives/new.md', 'n\n');
  const run = w.act(['save', '--path', 'archives/new.md', '--message', 'save']);
  assert.equal(run.code, 1);
  assert.deepEqual(pushes(w.calls), [], 'nothing is pushed');
  assert.equal(spawnSync('git', ['--git-dir', w.remote, 'merge-base', '--is-ancestor', tip, 'main']).status, 0, 'the remote history is intact');
});
