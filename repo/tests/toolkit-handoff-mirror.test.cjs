'use strict';

// The handoff snapshot mirrors the memory folder, deletes included (a b c, then c deleted, leaves a b),
// without letting a stale, partial or other computer's copy delete or bring back what a newer session
// decided. Each test below is one row of the mirror closure matrix: a removal needs this computer's
// folder record or the session baseline to have held exactly the snapshot's content, and so does an
// update of a memory row (else the row stays and is named diverged); a removed file
// comes back only from different content saved more than 5 minutes after the removal; a clock behind
// the snapshot removes and brings back nothing; a mass removal is held until a manual run confirms it;
// and the store accepts a deletion only as the handoff snapshot's own. Real Git against a local bare
// store for the store rows; --out folders otherwise. Fakes only: temp folders, never a real memory
// folder or store.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const store = require('../scripts/toolkit-store.cjs');
const handoff = require('../scripts/toolkit-handoff.cjs');
const hookModule = require('../scripts/toolkit-handoff-hook.cjs');
const { git, pushes, world } = require('./support/toolkit-store-world.cjs');

const FOLDER = 'evidence/handoff/acme/widget';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const iso = text => new Date(text).toISOString();
const MINUTE = 60 * 1000;

// One computer's view: a controlled-repository checkout (acme/widget), a memory folder holding
// MEMORY.md, a.md, b.md and c.md saved at different times, an --out snapshot folder and this
// computer's Toolkit user-state folder (the run record and folder records).
function mirror(t, { state = 'state' } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-mirror-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'widget');
  git(base, 'init', '--quiet', repo);
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  const memory = path.join(base, 'memory');
  const put = (rel, text, when) => {
    const file = path.join(memory, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, new Date(when), new Date(when));
    return file;
  };
  const drop = rel => fs.rmSync(path.join(memory, ...rel.split('/')));
  put('MEMORY.md', '# Memory\n- a, b, c\n', '2026-11-21T08:00:00Z');
  put('a.md', 'a v1\n', '2026-11-21T09:00:00Z');
  put('b.md', 'b v1\n', '2026-11-21T09:10:00Z');
  put('c.md', 'c v1\n', '2026-11-21T09:20:00Z');
  const out = path.join(base, 'drive');
  const computer = name => path.join(base, name, 'handoff-refresh.json');
  const run = (argv, { now = '2026-11-21T13:00:00Z', on = state, extra = {} } = {}) => {
    const lines = [];
    const code = store.main(['handoff', '--out', out, '--repo-root', repo, ...argv, '--json'], { handoffState: computer(on), now: () => new Date(now), stdout: text => lines.push(text), stderr: text => lines.push(text), ...extra });
    // A usage error (exit 2) prints the usage line, not JSON.
    return { code, result: code === 2 ? null : JSON.parse(lines.join('')) };
  };
  const manifestFile = path.join(out, FOLDER, 'manifest.json');
  const manifest = () => JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const row = name => manifest().files.find(item => item.path === name);
  const removed = name => (manifest().removed || []).find(item => item.path === name);
  const copy = name => path.join(out, FOLDER, ...name.split('/'));
  // A session baseline as the after-tool hook takes it: the files this session holds now.
  const baseline = name => {
    const file = path.join(base, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ rows: handoff.sessionRows({ memory, instructions: null, files: [] }) }));
    return file;
  };
  return { base, repo, memory, put, drop, out, run, manifest, manifestFile, row, removed, copy, baseline, computer };
}

// ---- removal: a b c, then c deleted, leaves a b ------------------------------------------------

test('a file the session deleted leaves the mirror: no row, no copy, a removed row with its time (R2, hook run)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const session = m.baseline('session');
  m.drop('c.md');
  const result = m.run(['--baseline', session]).result;
  assert.equal(result.handoff, 'WRITTEN', JSON.stringify(result));
  assert.equal(result.removed, 'memory/c.md');
  assert.equal(m.row('memory/c.md'), undefined, 'no row');
  assert.equal(fs.existsSync(m.copy('memory/c.md')), false, 'no copy left in the snapshot');
  assert.deepEqual(m.removed('memory/c.md'), { path: 'memory/c.md', sha256: sha('c v1\n'), modified: iso('2026-11-21T09:20:00Z'), removed_at: iso('2026-11-21T13:00:00Z'), source: m.memory });
  assert.deepEqual(m.manifest().files.map(item => item.path), ['MEMORY.md', 'memory/a.md', 'memory/b.md']);
  assert.equal(m.manifest().schema, 'toolkit.handoff-snapshot.v2');
  assert.equal(m.run(['--check']).result.handoff, 'CURRENT');
});

test('a file deleted between sessions (no hook saw it) leaves the mirror through this computer\'s folder record (R2, manual run)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.drop('c.md');
  // The controller check sees it before any run.
  const checked = m.run(['--check']);
  assert.equal(checked.code, 1);
  assert.deepEqual([checked.result.handoff, checked.result.removed], ['STALE', 'memory/c.md']);
  assert.equal(m.run([]).result.handoff, 'WRITTEN');
  assert.equal(m.row('memory/c.md'), undefined);
  assert.equal(fs.existsSync(m.copy('memory/c.md')), false);
  assert.ok(m.removed('memory/c.md'));
});

test('the removal time is the memory folder\'s modified time when it lies after the file\'s last state, else the run time', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory], { now: '2026-11-21T10:00:00Z' }).result.handoff, 'WRITTEN');
  // The delete moves the folder's time to the real clock, after this run's (fake) time: the run time is used.
  m.drop('c.md');
  assert.equal(m.run([], { now: '2026-11-21T13:00:00Z' }).result.handoff, 'WRITTEN');
  assert.equal(m.removed('memory/c.md').removed_at, iso('2026-11-21T13:00:00Z'));
  // A folder time between the folder record (10:00) and now is the removal time.
  const n = mirror(t, { state: 'other' });
  assert.equal(n.run(['--memory', n.memory], { now: '2026-11-21T10:00:00Z' }).result.handoff, 'WRITTEN');
  n.drop('c.md');
  fs.utimesSync(n.memory, new Date('2026-11-21T11:30:00Z'), new Date('2026-11-21T11:30:00Z'));
  assert.equal(n.run([], { now: '2026-11-21T13:00:00Z' }).result.handoff, 'WRITTEN');
  assert.equal(n.removed('memory/c.md').removed_at, iso('2026-11-21T11:30:00Z'));
});

// ---- nothing wrong is removed --------------------------------------------------------------------

test('a fresh container, a partial sync, an empty or unreachable folder removes nothing (R4)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  // Another computer (no folder record) holding only a.md and MEMORY.md, as a partial sync leaves it.
  m.drop('b.md'); m.drop('c.md');
  assert.equal(m.run([], { on: 'fresh' }).result.handoff, 'UNCHANGED');
  assert.equal(m.run(['--baseline', m.baseline('fresh-session')], { on: 'fresh' }).result.handoff, 'UNCHANGED');
  for (const name of ['memory/b.md', 'memory/c.md']) { assert.ok(m.row(name), name); assert.ok(fs.existsSync(m.copy(name)), name); }
  // This computer with the folder emptied (a re-sync clears it first) or gone.
  fs.renameSync(m.memory, `${m.memory}.away`);
  fs.mkdirSync(m.memory);
  assert.equal(m.run([]).result.handoff, 'UNCHANGED');
  fs.rmSync(m.memory, { recursive: true });
  assert.equal(m.run([]).result.handoff, 'UNCHANGED');
  assert.equal(m.manifest().files.length, 4);
  assert.equal((m.manifest().removed || []).length, 0);
});

test('a newer save made elsewhere is never removed by this copy: the row changed since this computer held it (R2)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const session = m.baseline('session');
  // Computer B, synced with c v1 (its first run records that), saves c v2 later; its run writes that row.
  assert.equal(m.run([], { on: 'computer-b' }).result.handoff, 'UNCHANGED');
  m.put('c.md', 'c v2 (computer B)\n', '2026-11-21T12:00:00Z');
  assert.equal(m.run([], { on: 'computer-b' }).result.handoff, 'WRITTEN');
  assert.equal(m.row('memory/c.md').sha256, sha('c v2 (computer B)\n'));
  // Here c is missing: the folder record and the session baseline both hold c v1, not the row's v2.
  m.drop('c.md');
  assert.equal(m.run([]).result.handoff, 'UNCHANGED');
  assert.equal(m.run(['--baseline', session]).result.handoff, 'UNCHANGED');
  assert.equal(m.row('memory/c.md').sha256, sha('c v2 (computer B)\n'));
  assert.ok(fs.existsSync(m.copy('memory/c.md')));
});

// ---- an update needs the same evidence as a removal ---------------------------------------------

test('a second computer that never held a memory file adds files but never replaces one: the row stays, diverged, until a manual --reseed', t => {
  const m = mirror(t);
  // Computer A writes the snapshot and records the folder.
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const stored = m.row('MEMORY.md').sha256;
  // Computer B has no folder record and holds a newer, different MEMORY.md (not synced), plus a new file.
  m.put('MEMORY.md', '# Memory\n- computer B, not synced\n', '2026-11-21T12:00:00Z');
  m.put('d.md', 'd v1 (computer B)\n', '2026-11-21T12:05:00Z');
  const ran = m.run([], { on: 'computer-b' }).result;
  assert.equal(ran.handoff, 'WRITTEN', JSON.stringify(ran));
  assert.equal(ran.diverged, 'MEMORY.md');
  assert.equal(m.row('MEMORY.md').sha256, stored, 'the row computer A saved stays');
  assert.equal(m.row('memory/d.md').sha256, sha('d v1 (computer B)\n'), 'a new file is still added');
  // B's own runs never come to count its unsaved copy as held: its next run and a hook-started run keep the row.
  for (const argv of [[], ['--baseline', m.baseline('b-session')]]) {
    const again = m.run(argv, { on: 'computer-b' }).result;
    assert.deepEqual([again.handoff, again.diverged], ['UNCHANGED', 'MEMORY.md'], argv.join(' '));
  }
  assert.equal(m.row('MEMORY.md').sha256, stored);
  const checked = m.run(['--check'], { on: 'computer-b' });
  assert.equal(checked.code, 1);
  assert.deepEqual([checked.result.handoff, checked.result.diverged, checked.result.changed], ['STALE', 'MEMORY.md', undefined]);
  // A manual --reseed from B takes B's copy; then B holds it.
  assert.equal(m.run(['--reseed'], { on: 'computer-b' }).result.handoff, 'WRITTEN');
  assert.equal(m.row('MEMORY.md').sha256, sha('# Memory\n- computer B, not synced\n'));
  assert.equal(m.run(['--check'], { on: 'computer-b' }).result.handoff, 'CURRENT');
});

test('the computer that saved a memory file updates it: its folder record, or its session baseline, held the row', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  // Through the folder record: a manual run after an edit made between sessions.
  m.put('a.md', 'a v2\n', '2026-11-21T11:00:00Z');
  const ran = m.run([]).result;
  assert.deepEqual([ran.handoff, ran.diverged], ['WRITTEN', undefined], JSON.stringify(ran));
  assert.equal(m.row('memory/a.md').sha256, sha('a v2\n'));
  // Through the session baseline alone: a computer with no folder record whose session started
  // holding the stored content, then edited it.
  const session = m.baseline('c-session');
  m.put('b.md', 'b v2\n', '2026-11-21T11:30:00Z');
  const hooked = m.run(['--baseline', session], { on: 'computer-c' }).result;
  assert.deepEqual([hooked.handoff, hooked.diverged], ['WRITTEN', undefined], JSON.stringify(hooked));
  assert.equal(m.row('memory/b.md').sha256, sha('b v2\n'));
  assert.equal(m.run(['--check']).result.handoff, 'CURRENT');
});

test('a diverged file clears only by a manual run: the hook never passes --reseed or starts a run for it, and --replace-memory takes the named folder', t => {
  for (const record of [{ store: 'store', repo_root: 'repo', repository: 'acme/widget' }, { out: 'out', repo_root: 'repo', repository: 'acme/widget' }]) {
    const args = hookModule.runArgs(record, 'session.json');
    for (const flag of ['--reseed', '--replace-memory', '--confirm-removals']) assert.ok(!args.includes(flag), flag);
  }
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.put('MEMORY.md', '# Memory\n- computer B\n', '2026-11-21T12:00:00Z');
  assert.equal(m.run([], { on: 'computer-b' }).result.diverged, 'MEMORY.md');
  // Computer B's hook sees nothing it may change, so it starts no run, however often it checks.
  const h = hookHarness(m, 'computer-b');
  for (let index = 0; index < 3; index += 1) { assert.equal(h.fire(), 0); h.later(11); }
  assert.equal(h.started.length, 0);
  // --replace-memory (manual) makes B's folder the whole memory set, its content included.
  const replaced = m.run(['--memory', m.memory, '--replace-memory'], { on: 'computer-b' }).result;
  assert.deepEqual([replaced.handoff, replaced.diverged], ['WRITTEN', undefined]);
  assert.equal(m.row('MEMORY.md').sha256, sha('# Memory\n- computer B\n'));
});

test('a run whose clock is behind the snapshot removes and brings back nothing and says clock=behind', t => {
  const m = mirror(t);
  // Computer B's clock is ahead: its save carries a time an hour after this computer's now.
  m.put('a.md', 'a v2 (computer B)\n', '2026-11-21T14:00:00Z');
  assert.equal(m.run(['--memory', m.memory], { now: '2026-11-21T14:01:00Z' }).result.handoff, 'WRITTEN');
  m.drop('c.md');
  const ran = m.run([], { now: '2026-11-21T13:00:00Z' }).result;
  assert.deepEqual([ran.handoff, ran.clock, ran.removed], ['UNCHANGED', 'behind', undefined]);
  assert.ok(m.row('memory/c.md'));
  const checked = m.run(['--check'], { now: '2026-11-21T13:00:00Z' }).result;
  assert.deepEqual([checked.handoff, checked.clock], ['STALE', 'behind']);
  // A clock within 5 minutes is not behind; once it is right, the removal lands.
  assert.equal(m.run([], { now: '2026-11-21T13:56:00Z' }).result.removed, 'memory/c.md');
});

// ---- a removed file stays removed, unless new content comes later --------------------------------

test('a stale copy that still holds the removed file\'s bytes never brings it back, whatever its time (R3)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.drop('c.md');
  assert.equal(m.run([]).result.removed, 'memory/c.md');
  // Session B synced the folder earlier and kept c; its copy's time is even after the removal.
  m.put('c.md', 'c v1\n', '2026-11-21T15:00:00Z');
  for (const [argv, on] of [[[], 'state'], [['--baseline', m.baseline('stale-b')], 'computer-b'], [[], 'computer-b']]) {
    const result = m.run(argv, { now: '2026-11-21T15:30:00Z', on }).result;
    assert.equal(result.handoff, 'UNCHANGED', JSON.stringify(result));
  }
  assert.equal(m.row('memory/c.md'), undefined);
  assert.equal(fs.existsSync(m.copy('memory/c.md')), false);
  assert.equal(m.run(['--check'], { now: '2026-11-21T15:30:00Z' }).result.handoff, 'CURRENT', 'the same bytes are no news');
});

test('different content saved more than 5 minutes after the removal brings the file back; earlier stays removed and is named removed_here (R3)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.drop('c.md');
  assert.equal(m.run([]).result.handoff, 'WRITTEN');
  const removedAt = Date.parse(m.removed('memory/c.md').removed_at);
  // Saved 4 minutes after the removal: inside the margin, so it stays removed.
  m.put('c.md', 'c v2, saved soon after\n', new Date(removedAt + 4 * MINUTE).toISOString());
  assert.equal(m.run([], { now: '2026-11-21T13:30:00Z' }).result.handoff, 'UNCHANGED');
  const checked = m.run(['--check'], { now: '2026-11-21T13:30:00Z' });
  assert.deepEqual([checked.code, checked.result.handoff, checked.result.removed_here], [1, 'STALE', 'memory/c.md']);
  // A plain copy (every file saved at one moment) has no real times: it stays removed too.
  for (const name of ['MEMORY.md', 'a.md', 'b.md', 'c.md']) fs.utimesSync(path.join(m.memory, name), new Date('2026-11-21T13:20:00Z'), new Date('2026-11-21T13:20:00Z'));
  assert.equal(m.run([], { now: '2026-11-21T13:30:00Z', on: 'plain-copy' }).result.handoff, 'UNCHANGED');
  // Saved 6 minutes after, with real times: it comes back.
  m.put('MEMORY.md', '# Memory\n- a, b, c\n', '2026-11-21T08:00:00Z');
  m.put('a.md', 'a v1\n', '2026-11-21T09:00:00Z');
  m.put('b.md', 'b v1\n', '2026-11-21T09:10:00Z');
  m.put('c.md', 'c v3, a new decision\n', new Date(removedAt + 6 * MINUTE).toISOString());
  const back = m.run([], { now: '2026-11-21T13:30:00Z' }).result;
  assert.equal(back.handoff, 'WRITTEN', JSON.stringify(back));
  assert.equal(m.row('memory/c.md').sha256, sha('c v3, a new decision\n'));
  assert.equal(m.removed('memory/c.md'), undefined);
  assert.equal(fs.readFileSync(m.copy('memory/c.md'), 'utf8'), 'c v3, a new decision\n');
});

// ---- mass removals, leftovers and switching folders -----------------------------------------------

test('a run that would remove more than the limit removes none and says held_removals; only --confirm-removals applies them (R5)', t => {
  const m = mirror(t);
  for (let index = 1; index <= 12; index += 1) m.put(`topic-${String(index).padStart(2, '0')}.md`, `topic ${index}\n`, `2026-11-21T10:${String(index).padStart(2, '0')}:00Z`);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const session = m.baseline('session');
  // 16 memory rows: the limit is max(10, 3) = 10; 11 files are gone.
  for (let index = 1; index <= 11; index += 1) m.drop(`topic-${String(index).padStart(2, '0')}.md`);
  for (const argv of [[], ['--baseline', session]]) {
    const held = m.run(argv).result;
    assert.deepEqual([held.handoff, held.held_removals, held.removed], ['UNCHANGED', 11, undefined], JSON.stringify(held));
  }
  assert.equal(m.run(['--check']).result.held_removals, 11);
  assert.equal(m.manifest().files.length, 16);
  // The hook never confirms: --confirm-removals is a manual run only.
  for (const extra of [['--check'], ['--baseline', session]]) assert.equal(m.run(['--confirm-removals', ...extra]).code, 2, extra.join(' '));
  // The held run kept this computer's evidence, so the confirming run still removes them.
  const confirmed = m.run(['--confirm-removals']).result;
  assert.equal(confirmed.handoff, 'WRITTEN', JSON.stringify(confirmed));
  assert.equal(confirmed.removed.split(',').length, 11);
  assert.equal(m.manifest().files.length, 5);
  // Ten or fewer removals need no confirmation.
  for (const name of ['a.md', 'b.md']) m.drop(name);
  assert.equal(m.run([]).result.removed, 'memory/a.md,memory/b.md');
});

test('a snapshot copy no row lists is removed only when this computer held that content, or by --replace-memory; else it stays, named unlisted (R6)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const dropRow = name => {
    const manifest = m.manifest();
    manifest.files = manifest.files.filter(row => row.path !== name);
    fs.writeFileSync(m.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  };
  // A copy this computer never held (an older Toolkit copy, a hand edit, another computer's file whose
  // row a race dropped) stays, in a manual and a hook-started run, and is named.
  fs.writeFileSync(m.copy('memory/orphan.md'), 'an older copy\n');
  const checked = m.run(['--check']).result;
  assert.deepEqual([checked.handoff, checked.changed, checked.unlisted], ['STALE', undefined, 'memory/orphan.md']);
  for (const argv of [[], ['--baseline', m.baseline('session')]]) {
    const result = m.run(argv).result;
    assert.deepEqual([result.handoff, result.removed, result.unlisted], ['UNCHANGED', undefined, 'memory/orphan.md'], argv.join(' '));
    assert.ok(fs.existsSync(m.copy('memory/orphan.md')));
  }
  // A copy this computer held: its file was saved here, then deleted, and an older copy dropped the
  // row but left the copy. Its CRLF twin (a Git checkout with core.autocrlf) counts as the same content.
  m.put('held.md', 'held v1\n', '2026-11-21T09:30:00Z');
  m.put('crlf.md', 'line one\nline two\n', '2026-11-21T09:40:00Z');
  assert.equal(m.run([]).result.handoff, 'WRITTEN');
  m.drop('held.md');
  m.drop('crlf.md');
  dropRow('memory/held.md');
  dropRow('memory/crlf.md');
  fs.writeFileSync(m.copy('memory/crlf.md'), 'line one\r\nline two\r\n');
  const result = m.run([]).result;
  assert.deepEqual([result.handoff, result.removed, result.unlisted], ['WRITTEN', 'memory/crlf.md,memory/held.md', 'memory/orphan.md']);
  for (const name of ['memory/held.md', 'memory/crlf.md']) assert.equal(fs.existsSync(m.copy(name)), false, name);
  assert.equal(m.removed('memory/held.md').sha256, sha('held v1\n'));
  assert.equal(m.removed('memory/crlf.md').sha256, sha('line one\nline two\n'), 'the removed row keeps the content this computer held');
  // --replace-memory makes the named folder the whole memory set: the orphan goes too.
  const replaced = m.run(['--memory', m.memory, '--replace-memory']).result;
  assert.deepEqual([replaced.handoff, replaced.removed, replaced.unlisted], ['WRITTEN', 'memory/orphan.md', undefined]);
  assert.equal(fs.existsSync(m.copy('memory/orphan.md')), false);
  assert.equal(m.run(['--check']).result.handoff, 'CURRENT');
  // A copy outside the memory area is left alone.
  fs.mkdirSync(path.dirname(m.copy('files/loose.md')), { recursive: true });
  fs.writeFileSync(m.copy('files/loose.md'), 'loose\n');
  assert.equal(m.run([]).result.handoff, 'UNCHANGED');
  assert.ok(fs.existsSync(m.copy('files/loose.md')));
});

test('--replace-memory switches the mirrored folder and removes the old rows; naming another folder without it removes nothing (R7)', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  // This laptop's own memory folder: an older MEMORY.md and one topic file.
  const laptop = path.join(m.base, 'laptop-memory');
  fs.mkdirSync(laptop);
  const at = (file, text, when) => { fs.writeFileSync(file, text); fs.utimesSync(file, new Date(when), new Date(when)); };
  at(path.join(laptop, 'MEMORY.md'), '# Laptop memory\n- x\n', '2026-11-21T07:00:00Z');
  at(path.join(laptop, 'x.md'), 'x\n', '2026-11-21T07:30:00Z');
  const plain = m.run(['--memory', laptop]).result;
  assert.equal(plain.removed, undefined, 'a different folder without --replace-memory removes nothing');
  assert.ok(m.row('memory/c.md') && m.row('memory/x.md'));
  assert.equal(m.manifest().sources.memory, laptop);
  assert.equal(m.run(['--replace-memory']).code, 2, 'it needs --memory');
  for (const extra of [['--check'], ['--baseline', m.baseline('s')]]) assert.equal(m.run(['--memory', laptop, '--replace-memory', ...extra]).code, 2, extra.join(' '));
  const replaced = m.run(['--memory', laptop, '--replace-memory']).result;
  assert.equal(replaced.handoff, 'WRITTEN', JSON.stringify(replaced));
  assert.equal(replaced.removed, 'memory/a.md,memory/b.md,memory/c.md');
  assert.deepEqual(m.manifest().files.map(item => item.path), ['MEMORY.md', 'memory/x.md']);
  assert.equal(fs.readFileSync(m.copy('MEMORY.md'), 'utf8'), '# Laptop memory\n- x\n', 'the named folder\'s content wins');
  for (const name of ['a.md', 'b.md', 'c.md']) assert.equal(fs.existsSync(m.copy(`memory/${name}`)), false, name);
  assert.equal(m.run(['--check']).result.handoff, 'CURRENT');
  // An unreachable folder is refused, nothing written.
  const before = fs.readFileSync(m.manifestFile, 'utf8');
  assert.equal(m.run(['--memory', path.join(m.base, 'nowhere'), '--replace-memory']).code, 1);
  assert.equal(fs.readFileSync(m.manifestFile, 'utf8'), before);
});

// ---- manifest version -----------------------------------------------------------------------------

// The reader of the Toolkit copy before this change (toolkit-handoff.cjs at c11471c), verbatim in effect.
function olderReadManifest(base, folder) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(base, folder, 'manifest.json'), 'utf8'));
    return manifest && manifest.schema === 'toolkit.handoff-snapshot.v1' && Array.isArray(manifest.files) ? manifest : null;
  } catch { return null; }
}

test('a v1 snapshot is read and rewritten as v2 by its first change; an older copy reads v2 as no snapshot, so its hook does nothing', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  const v1 = { ...m.manifest(), schema: 'toolkit.handoff-snapshot.v1' };
  delete v1.removed;
  fs.writeFileSync(m.manifestFile, `${JSON.stringify(v1, null, 2)}\n`);
  assert.ok(olderReadManifest(m.out, FOLDER), 'the older copy reads v1');
  assert.equal(handoff.readManifest(m.out, FOLDER).files.length, 4, 'this copy reads v1');
  assert.equal(m.run([]).result.handoff, 'UNCHANGED');
  m.drop('c.md');
  assert.equal(m.run([]).result.handoff, 'WRITTEN');
  assert.equal(m.manifest().schema, 'toolkit.handoff-snapshot.v2');
  assert.equal(olderReadManifest(m.out, FOLDER), null, 'an older copy finds no snapshot: its hook returns before it plans');
});

// ---- the after-tool hook -----------------------------------------------------------------------

function hookHarness(m, on = 'state') {
  const dir = path.join(m.base, on);
  const started = [];
  const clock = { now: Date.parse('2026-11-21T13:00:00Z') };
  const fire = () => hookModule.main({
    stdin: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'session-a', cwd: m.base, tool_name: 'Bash', tool_input: { command: 'true' } }),
    stateDirectory: dir, home: path.join(m.base, 'home'), handoffRecord: m.computer(on), now: () => clock.now,
    spawn: (command, args, options) => { started.push({ command, args, options }); return { unref() {} }; },
  });
  return { started, fire, later: minutes => { clock.now += minutes * MINUTE; } };
}

test('the hook starts a run for a file deleted between sessions, which only the folder record shows', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.drop('c.md');
  const h = hookHarness(m);
  assert.equal(h.fire(), 0); // the session's first check: its baseline, which already lacks c
  h.later(2);
  assert.equal(h.fire(), 0);
  assert.equal(h.started.length, 1);
});

test('the hook starts no run for a stale copy that still holds a removed file', t => {
  const m = mirror(t);
  assert.equal(m.run(['--memory', m.memory]).result.handoff, 'WRITTEN');
  m.drop('c.md');
  assert.equal(m.run([]).result.removed, 'memory/c.md');
  m.put('c.md', 'c v1\n', '2026-11-21T09:20:00Z');
  const h = hookHarness(m);
  for (let index = 0; index < 3; index += 1) { assert.equal(h.fire(), 0); h.later(11); }
  assert.equal(h.started.length, 0);
});

// ---- the store: the handoff snapshot's own deletions, and no other -------------------------------

function storeMirror(t) {
  const w = world(t);
  const m = mirror(t);
  const act = (argv, now = '2026-11-21T13:00:00Z') => w.act(['handoff', '--repo-root', m.repo, ...argv], { handoffState: m.computer('state'), now: () => new Date(now) });
  return { w, m, act };
}

test('a store run removes the deleted file from the store tip, and Git history keeps its last copy (R2, R8, R9)', t => {
  const { w, m, act } = storeMirror(t);
  const first = act(['--memory', m.memory]);
  assert.equal(first.result.handoff, 'SAVED', JSON.stringify(first.result));
  m.drop('c.md');
  const saved = act([]);
  assert.equal(saved.code, 0, JSON.stringify(saved.result));
  assert.deepEqual([saved.result.handoff, saved.result.removed, saved.result.read_back], ['SAVED', 'memory/c.md', true]);
  assert.equal(w.remoteHas(`${FOLDER}/memory/c.md`), false, 'the store tip has no copy');
  assert.ok(JSON.parse(w.remoteFile(`${FOLDER}/manifest.json`)).removed.some(item => item.path === 'memory/c.md'));
  // Recovery: the removal commit is listed, and its parent holds the last copy.
  const removal = git(w.dir, 'log', '--format=%H', '--diff-filter=D', '--', `${FOLDER}/memory/`);
  assert.match(removal, /^[0-9a-f]{40}$/);
  assert.equal(git(w.dir, 'show', `${removal}^:${FOLDER}/memory/c.md`), 'c v1');
  assert.equal(act([]).result.handoff, 'UNCHANGED');
});

test('a kept handoff commit with its removals is checked again and pushed by the next run', t => {
  const { w, m, act } = storeMirror(t);
  assert.equal(act(['--memory', m.memory]).result.handoff, 'SAVED');
  m.drop('c.md');
  w.hooks.refusePushes = 4;
  assert.equal(act([]).code, 1, 'the push failed; the commit is kept');
  assert.ok(w.remoteHas(`${FOLDER}/memory/c.md`));
  const again = act([]);
  assert.equal(again.code, 0, JSON.stringify(again.result));
  assert.equal(again.result.resumed, 1);
  assert.equal(w.remoteHas(`${FOLDER}/memory/c.md`), false);
});

test('every other deletion is still refused: save, merge-branch, and hand commits outside the memory area or without a removed row (R8)', t => {
  const { w, m, act } = storeMirror(t);
  assert.equal(act(['--memory', m.memory, '--file', m.put('../plan.md', 'plan\n', '2026-11-21T09:00:00Z')]).result.handoff, 'SAVED');
  const manifestPath = path.join(w.dir, ...FOLDER.split('/'), 'manifest.json');
  const listRemoved = rel => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const row = manifest.files.find(item => item.path === rel);
    manifest.files = manifest.files.filter(item => item.path !== rel);
    manifest.removed = [...(manifest.removed || []), { path: rel, sha256: row.sha256, removed_at: '2026-11-21T12:00:00.000Z', source: m.memory }];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };
  const reset = () => { git(w.dir, 'reset', '--quiet', '--hard', 'origin/main'); w.calls.length = 0; };
  // save never stages a deletion, even with the manifest listing the file as removed.
  fs.rmSync(path.join(w.dir, ...FOLDER.split('/'), 'memory', 'c.md'));
  listRemoved('memory/c.md');
  const saved = w.act(['save', '--path', FOLDER, '--message', 'hand removal']);
  assert.equal(saved.code, 0, JSON.stringify(saved.result));
  assert.ok(w.remoteHas(`${FOLDER}/memory/c.md`), 'save left the file in the store');
  reset();
  const tip = w.remoteTip();
  const cases = [
    ['a memory file with no removed row', () => { git(w.dir, 'rm', '--quiet', `${FOLDER}/memory/b.md`); git(w.dir, 'commit', '--quiet', '-m', 'drop b'); }, /memory\/b\.md would be deleted or changed away/],
    ['a working file listed as removed', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.removed = [{ path: 'files/plan.md', sha256: manifest.files.find(item => item.path === 'files/plan.md').sha256, removed_at: '2026-11-21T12:00:00.000Z', source: m.memory }];
      manifest.files = manifest.files.filter(item => item.path !== 'files/plan.md');
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      git(w.dir, 'rm', '--quiet', `${FOLDER}/files/plan.md`); git(w.dir, 'add', '-A'); git(w.dir, 'commit', '--quiet', '-m', 'drop plan');
    }, /files\/plan\.md would be deleted or changed away/],
    ['a file outside any snapshot', () => { git(w.dir, 'rm', '--quiet', 'archives/old/kept.md'); git(w.dir, 'commit', '--quiet', '-m', 'drop kept'); }, /archives\/old\/kept\.md would be deleted or changed away/],
  ];
  for (const [label, plant, said] of cases) {
    reset();
    plant();
    w.write('archives/new.md', 'new\n');
    const run = w.act(['save', '--path', 'archives/new.md', '--message', 'new']);
    assert.equal(run.code, 1, label);
    assert.match(run.result.stopped, said, label);
    assert.equal(w.remoteTip(), tip, label);
    // The handoff run refuses the same kept commit.
    assert.equal(act([]).code, 1, `${label}: handoff`);
    assert.equal(w.remoteTip(), tip, `${label}: handoff`);
  }
  // merge-branch keeps refusing a deletion, even the snapshot's own.
  reset();
  git(w.other, 'fetch', '--quiet', 'origin');
  git(w.other, 'checkout', '--quiet', '-B', 'cloud-removal', 'origin/main');
  const otherManifest = path.join(w.other, ...FOLDER.split('/'), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(otherManifest, 'utf8'));
  manifest.removed = [{ path: 'memory/a.md', sha256: manifest.files.find(item => item.path === 'memory/a.md').sha256, removed_at: '2026-11-21T12:00:00.000Z', source: m.memory }];
  manifest.files = manifest.files.filter(item => item.path !== 'memory/a.md');
  fs.writeFileSync(otherManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  git(w.other, 'rm', '--quiet', `${FOLDER}/memory/a.md`); git(w.other, 'add', '-A'); git(w.other, 'commit', '--quiet', '-m', 'removal'); git(w.other, 'push', '--quiet', '--force', 'origin', 'cloud-removal');
  const merged = w.act(['merge-branch', '--branch', 'cloud-removal', '--message', 'merge']);
  assert.equal(merged.code, 1);
  assert.match(merged.result.stopped, /memory\/a\.md would be deleted or changed away/);
  assert.equal(w.remoteTip(), tip);
  assert.deepEqual(pushes(w.calls), []);
});
