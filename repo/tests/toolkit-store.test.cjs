'use strict';

// toolkit store: every step checks the store itself first, reads and moves only inside the store
// folders, and takes only the pinned commands and flags.
// Real Git against a local bare repository; only the GitHub read, the binding read and the reported
// remote address are faked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const store = require('../scripts/toolkit-store.cjs');
const { ORIGIN, git, pushes, world } = require('./support/toolkit-store-world.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

test('the pre-flight refuses anything that is not the private, writable bound store on its branch', t => {
  const w = world(t);
  w.write('archives/a.md', 'a\n');
  const save = extra => w.act(['save', '--path', 'archives/a.md', '--message', 'a'], extra);
  const cases = [
    ['another origin', () => { w.reported.origin = 'https://github.com/someone/else.git'; }, () => { w.reported.origin = ORIGIN; }, /not a checkout of the bound evidence store/],
    ['a second push address', () => { w.reported.push = `${ORIGIN}\nhttps://github.com/someone/else.git`; }, () => { w.reported.push = ORIGIN; }, /pushes somewhere other than the evidence store/],
    ['a push rule', () => git(w.dir, 'config', 'remote.origin.push', '+refs/heads/main:refs/heads/main'), () => git(w.dir, 'config', '--unset', 'remote.origin.push'), /own config that could change a step \(remote\.origin\.push\)/],
    ['a mirror', () => git(w.dir, 'config', 'remote.origin.mirror', 'true'), () => git(w.dir, 'config', '--unset', 'remote.origin.mirror'), /remote\.origin\.mirror/],
    ['a URL rewrite', () => git(w.dir, 'config', 'url.https://evil.example/.insteadOf', 'https://github.com/'), () => git(w.dir, 'config', '--remove-section', 'url.https://evil.example/'), /url\.https:\/\/evil\.example\/\.insteadof/],
    ['a credential helper', () => git(w.dir, 'config', 'credential.helper', '!evil'), () => git(w.dir, 'config', '--unset', 'credential.helper'), /credential\.helper/],
    ['a clean filter', () => git(w.dir, 'config', 'filter.x.clean', 'evil'), () => git(w.dir, 'config', '--remove-section', 'filter.x'), /filter\.x\.clean/],
    ['its own hooks path', () => git(w.dir, 'config', 'core.hooksPath', '.githooks'), () => git(w.dir, 'config', '--unset', 'core.hooksPath'), /core\.hookspath/],
    ['another branch', () => git(w.dir, 'checkout', '--quiet', '-b', 'side'), () => git(w.dir, 'checkout', '--quiet', 'main'), /not on the bound branch main/],
    ['a public store', () => { w.github.private = false; }, () => { w.github.private = true; }, /is not private/],
    ['no write access', () => { w.github.permissions.push = false; }, () => { w.github.permissions.push = true; }, /cannot write to the evidence store/],
    ['a bound branch that is not the default', () => { w.github.default_branch = 'trunk'; }, () => { w.github.default_branch = 'main'; }, /not the store's default branch/],
    ['another repository on GitHub', () => { w.github.full_name = 'Owner/Other'; }, () => { w.github.full_name = 'Owner/Store'; }, /names a different repository/],
  ];
  for (const [label, set, unset, said] of cases) {
    set();
    const run = save();
    unset();
    assert.equal(run.code, 1, label);
    assert.match(run.result.stopped, said, label);
  }
  assert.match(save({ readGitHub: () => { throw new Error('offline'); } }).result.stopped, /GitHub could not be read/);
  assert.match(save({ readBinding: () => ({ ok: false, reason: 'the merged binding was not read in the last day' }) }).result.stopped, /no bound evidence store: the merged binding was not read in the last day/);
  assert.match(save({ readBinding: () => ({ ok: true, store: { kind: 'github', repository: 'Owner/Store', branch: '--mirror', path: 'x/' } }) }).result.stopped, /not a plain branch name/);
  const sub = store.main(['status', '--store', path.join(w.dir, 'archives'), '--json'], { ...w.deps, stdout: () => {} });
  assert.equal(sub, 1, 'a folder inside the checkout is not the store top');
  assert.deepEqual(pushes(w.calls), [], 'no refused run pushes');
  assert.deepEqual(fs.readdirSync(w.tmp), [], 'every refused run removes its hooks folder');

  // The caller's GIT_* environment never reaches Git: a GIT_DIR naming another repository is dropped.
  const run = save({ environment: { ...w.deps.environment, GIT_DIR: path.join(w.other, '.git'), GIT_WORK_TREE: w.other } });
  assert.equal(run.code, 0, JSON.stringify(run.result));
  assert.ok(w.remoteHas('archives/a.md'));
});

test('a repository hook in the store checkout never runs', t => {
  const w = world(t);
  const marker = path.join(w.base, 'HOOK-RAN');
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'pre-push']) {
    fs.writeFileSync(path.join(w.dir, '.git', 'hooks', name), `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`, { mode: 0o755 });
  }
  w.write('archives/h.md', 'h\n');
  assert.equal(w.act(['save', '--path', 'archives/h.md', '--message', 'h']).code, 0);
  assert.ok(!fs.existsSync(marker));
});

test('status and sync read and fast-forward only', t => {
  const w = world(t);
  fs.writeFileSync(path.join(w.other, 'archives', 'old', 'b.md'), 'b\n');
  git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'b'); git(w.other, 'push', '--quiet', 'origin', 'main');
  const status = w.act(['status']);
  assert.equal(status.code, 0);
  assert.equal(status.result.checked, true);
  assert.equal(status.result.ahead, 0);
  const synced = w.act(['sync']);
  assert.equal(synced.code, 0);
  assert.equal(synced.result.commit, git(w.other, 'rev-parse', 'HEAD'));
  assert.ok(w.calls.filter(args => args[0] === 'merge').every(args => args.includes('--ff-only')));
});

test('move renames with git mv only, inside the store folders', t => {
  const w = world(t);
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'elsewhere/loose.json', '--message', 'm']).result.stopped, /outside the store folders/);
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'archives/old/kept.md', '--message', 'm']).result.stopped, /already exists/);
  const outside = path.join(w.base, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.dir, 'archives', 'link'), 'junction');
  assert.match(w.act(['move', '--from', 'loose.json', '--to', 'archives/link/deep/loose.json', '--message', 'm']).result.stopped, /archives\/link leads out of the store checkout through a link/);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing is created through the link');
  w.write('archives/real.md', 'real\n');
  fs.symlinkSync(path.join(outside), path.join(w.dir, 'evidence-link'), 'junction');
  assert.match(w.act(['save', '--path', 'archives/link', '--message', 'm']).result.stopped, /leads out of it through a link/);
  fs.rmSync(path.join(w.dir, 'archives', 'link')); fs.rmSync(path.join(w.dir, 'evidence-link')); fs.rmSync(path.join(w.dir, 'archives', 'real.md'));
  const { code, result } = w.act(['move', '--from', 'loose.json', '--to', 'archives/loose/loose.json', '--message', 'tidy loose file']);
  assert.equal(code, 0, JSON.stringify(result));
  assert.ok(w.remoteHas('archives/loose/loose.json') && !w.remoteHas('loose.json'));
  assert.match(git(w.dir, 'show', '--name-status', '-M100%', '--format=', 'HEAD'), /^R100\tloose\.json\tarchives\/loose\/loose\.json$/);
});

test('the command line refuses unknown commands, flags and messages, and the flag table is pinned', () => {
  for (const argv of [[], ['upload'], ['save', '--store', 'x', '--path', 'a'], ['save', '--store', 'x', '--message', 'm'], ['save', '--store', 'x', '--path', 'a', '--message', 'two\nlines'],
    ['status', '--force'], ['status', '--store', 'a', '--store', 'b'], ['move', '--store', 'x', '--from', 'a', '--message', 'm'], ['delete-merged-branch', '--store', 'x'], ['sync', '--path', 'a']]) {
    assert.equal(store.main(argv, { stdout: () => {}, stderr: () => {} }), 2, argv.join(' '));
  }
  assert.deepEqual(store.COMMANDS, ['status', 'sync', 'save', 'move', 'merge-branch', 'delete-merged-branch']);
  assert.deepEqual(store.VALUE_FLAGS, {
    status: ['--store', '--repo-root'], sync: ['--store', '--repo-root'], save: ['--store', '--repo-root', '--path', '--message'],
    move: ['--store', '--repo-root', '--from', '--to', '--message'], 'merge-branch': ['--store', '--repo-root', '--branch', '--message'],
    'delete-merged-branch': ['--store', '--repo-root', '--branch'],
  });
  const flags = [...fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-store.cjs'), 'utf8').matchAll(/'(--[a-z-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(flags)].filter(flag => !['--literal-pathspecs', '--show-toplevel', '--push', '--all', '--list', '--show-scope', '--includes', '--quiet', '--no-tags', '--no-recurse-submodules', '--left-right', '--count', '--cached', '--raw', '--no-abbrev', '--ignore-removal', '--ff-only', '--no-ff', '--no-edit', '--no-commit', '--abort', '--is-ancestor', '--heads', '--name-only', '--verify', '--delete', '--porcelain', '--untracked-files=all', '--is-shallow-repository', '--objects', '--batch-check=%(objecttype) %(objectname)'].includes(flag)).sort(),
    ['--branch', '--from', '--json', '--message', '--path', '--repo-root', '--store', '--to'], 'every caller flag is in the pinned table');
  assert.equal(store.mergedStoreBinding(os.tmpdir()).ok, false);
});

test('the retired handoff snapshot command is refused as unknown, with nothing run or written', t => {
  // An empty folder outside any repository, so nothing could be written into a real checkout.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-store-handoff-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const argv of [['handoff', '--store', 'x'], ['handoff', '--check', '--store', 'x', '--repo-root', 'y'], ['handoff', '--out', 'x', '--replace-memory', '--memory', 'm']]) {
    const err = [];
    const run = [];
    assert.equal(store.main(argv, { cwd, stdout: () => {}, stderr: text => err.push(text), run: (...args) => { run.push(args); return { status: 1 }; } }), 2, argv.join(' '));
    assert.match(err.join(''), /^Stopped: unknown command "handoff"\./, argv.join(' '));
    assert.deepEqual(run, [], 'no Git call is made');
    assert.deepEqual(fs.readdirSync(cwd), [], 'nothing is written');
  }
});

test('a shallow store checkout is refused', t => {
  const w = world(t);
  const shallow = path.join(w.base, 'shallow');
  git(w.base, 'clone', '--quiet', '--depth', '1', `file://${w.remote}`, shallow);
  git(shallow, 'config', 'user.name', 'Test'); git(shallow, 'config', 'user.email', 'test@example.invalid');
  const out = [];
  assert.equal(store.main(['status', '--store', shallow, '--json'], { ...w.deps, stdout: text => out.push(text) }), 1);
  assert.match(JSON.parse(out.join('')).stopped, /shallow/);
});

test('global push settings that could widen a push are refused, and git is found on PATH by full path', t => {
  const w = world(t);
  w.write('archives/g.md', 'g\n');
  for (const [key, section, name, value] of [['remote.origin.mirror', 'remote "origin"', 'mirror', 'true'], ['remote.origin.push', 'remote "origin"', 'push', '+refs/heads/*:refs/heads/*'], ['push.followtags', 'push', 'followTags', 'true']]) {
    fs.writeFileSync(path.join(w.home, '.gitconfig'), `[${section}]\n\t${name} = ${value}\n`);
    const run = w.act(['save', '--path', 'archives/g.md', '--message', 'g']);
    assert.ok((run.result?.stopped || '').includes(`could widen a store push (${key})`), key);
  }
  fs.rmSync(path.join(w.home, '.gitconfig'));
  const seen = [];
  assert.equal(w.act(['save', '--path', 'archives/g.md', '--message', 'g'], { run: (cmd, args, options) => { seen.push(cmd); return w.deps.run(cmd, args, options); } }).code, 0);
  assert.ok(seen.every(cmd => path.isAbsolute(cmd)), 'git is run by its full path');
});
