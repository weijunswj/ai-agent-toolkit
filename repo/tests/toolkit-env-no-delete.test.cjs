'use strict';

// The edit file is the only way Toolkit deletes a key. The closure table of the plan, one test row per
// matrix row, on a stand-in store that counts every delete. A saved edit file is applied exactly (added,
// changed and removed lines on that save, with no question), the emptied-tab refusal stays, no other
// command deletes, the store's delete has one call site, and no test can reach the real key store.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  clockAt, editFile, editFiles, editState, harness, save, sentinel, storeImage, tempHome,
} = require('./support/toolkit-env-harness.cjs');
const { EnvManifest } = require('../scripts/toolkit-env.cjs');
const { PlatformStore, STORE_PREFIX, WindowsCredentialStore } = require('../scripts/toolkit-env-store.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'repo', 'scripts');
const TESTS = path.join(ROOT, 'repo', 'tests');
const SCRIPT = path.join(SCRIPTS, 'toolkit-env.cjs');

const KEYS = () => ({ X1_TEST_KEPT_KEY: sentinel(), X1_TEST_GONE_KEY: sentinel(), X1_TEST_OTHER_KEY: sentinel() });

// An open edit (state E1) and its helper, started and settled.
async function opened(t, options = {}) {
  const clock = clockAt();
  const h = harness(t, { clock, values: KEYS(), ...options });
  await h.run('edit');
  const file = editFile(h.paths);
  const watcher = h.env.editWatcher(file, { pid: 811, alive: () => true });
  assert.equal(watcher.start(), true);
  watcher.tick();
  return { h, clock, file, watcher };
}

// One save the helper applies: the file changes, then stays still for longer than 1.5 seconds.
function saveAndSettle({ clock, file, watcher }, text) {
  save(file, text);
  watcher.tick();
  clock.ms += 2000;
  watcher.tick();
}

const without = (text, ...names) => names.reduce((body, name) => body.replace(new RegExp(`^${name}=.*\\r?\\n`, 'm'), ''), text);

test('row 1: a removed line deletes its key on that save, with no question', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  saveAndSettle(run, without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY'));
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), undefined, 'deleted on the save');
  assert.equal(h.store.removes, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Status: saved \(\d\d:\d\d UTC\)\. Removed: X1_TEST_GONE_KEY\.\r?$/m);
  const record = JSON.parse(fs.readFileSync(h.paths.manifest, 'utf8'));
  assert.ok(!('X1_TEST_GONE_KEY' in record.names) && !record.layout.includes('X1_TEST_GONE_KEY'), 'name and layout dropped');
  assert.ok(!editState(h.paths).snapshot.includes('X1_TEST_GONE_KEY'), 'the tab no longer lists it');
  assert.doesNotMatch((await h.run('status')).stdout, /Waiting for/);
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.deepEqual(h.asked, [], 'no question at any point');
  assert.equal(h.store.removes, 1, 'done deletes nothing more');
});

test('row 2: a removed, a changed and an added line all apply in one save', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  const fresh = sentinel();
  const added = sentinel();
  saveAndSettle(run, `${without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY').replace(/^X1_TEST_KEPT_KEY=.*$/m, `X1_TEST_KEPT_KEY=${fresh}`)}X1_TEST_ADDED_KEY=${added}\n`);
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), undefined);
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), fresh);
  assert.equal(h.store.peek('X1_TEST_ADDED_KEY'), added);
  const done = await h.run('apply');
  assert.match(done.stdout, /^changed: X1_TEST_KEPT_KEY$/m);
  assert.match(done.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.deepEqual(h.asked, []);
});

test('row 3: a save that removes every stored listed key, or an empty file, is refused and says how to delete by hand', async (t) => {
  for (const [label, text] of [['every line deleted', (body) => body.split(/\r?\n/).filter((line) => line.startsWith('#')).join('\n')], ['empty file', () => '']]) {
    await t.test(label, async (t) => {
      const run = await opened(t);
      const { h, file } = run;
      const before = storeImage(h);
      saveAndSettle(run, text(fs.readFileSync(file, 'utf8')));
      assert.equal(storeImage(h), before);
      assert.equal(h.store.removes, 0);
      assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. This save would remove every key\./m);
      const done = await h.run('apply');
      assert.equal(done.code, 1);
      assert.match(done.stderr, /Nothing was saved: this save would remove every key\./);
      assert.match(done.stderr, /Windows Credential Manager/, 'the message names the by-hand route');
      assert.doesNotMatch(done.stderr, /remove NAME/);
    });
  }
  // A one-key store: deleting its only line is the same refusal.
  const single = harness(t, { values: { X1_TEST_ONLY_KEY: sentinel() } });
  await single.run('edit');
  save(editFile(single.paths), '');
  assert.match((await single.run('apply')).stderr, /would remove every key/);
  assert.equal(single.store.removes, 0);
});

test('row 4: a removed line whose key changed elsewhere since the tab was made refuses the whole save', async (t) => {
  for (const [label, elsewhere] of [
    ['set with toolkit env', async (h, clock) => { clock.ms += 1000; await h.run('set', 'X1_TEST_GONE_KEY'); clock.ms += 1000; }],
    ['changed straight in the store', async (h) => { h.store.writeAll(new Map([['X1_TEST_GONE_KEY', sentinel()]])); }],
  ]) {
    await t.test(label, async (t) => {
      const run = await opened(t, { hidden: [sentinel()] });
      const { h, clock, file } = run;
      await elsewhere(h, clock);
      const before = storeImage(h);
      saveAndSettle(run, `${without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY')}X1_TEST_ADDED_KEY=${sentinel()}\n`);
      assert.equal(storeImage(h), before, 'nothing written or deleted');
      assert.equal(h.store.removes, 0);
      assert.match(fs.readFileSync(file, 'utf8'), /^# Status: NOT SAVED .*These keys changed while this tab was open: X1_TEST_GONE_KEY\./m);
    });
  }
});

test('row 5: a removed line in a save with a blocking problem deletes nothing', async (t) => {
  for (const [label, extra] of [
    ['bad name', 'bad_name_here=x\n'],
    ['quoted value', 'X1_TEST_QUOTE_KEY="quoted"\n'],
    ['duplicate name', `X1_TEST_KEPT_KEY=${sentinel()}\n`],
    ['too long', `X1_TEST_LONG_KEY=${'x'.repeat(2561)}\n`],
    ['secret-like comment', '# X1_TEST_HIDDEN_KEY=hidden-value-123\n'],
    ['UTF-16', null],
  ]) {
    await t.test(label, async (t) => {
      const run = await opened(t);
      const { h, file } = run;
      const before = storeImage(h);
      const body = without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY');
      if (extra === null) {
        save(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]));
        run.watcher.tick(); run.clock.ms += 2000; run.watcher.tick();
      } else saveAndSettle(run, `${body}${extra}`);
      assert.equal(storeImage(h), before);
      assert.equal(h.store.removes, 0);
      const done = await h.run('apply');
      assert.equal(done.code, 1, label);
      assert.match(done.stderr, /Nothing was saved/);
    });
  }
});

test('row 8: a <kept: ...> line leaves its key as it is', async (t) => {
  const run = await opened(t, { values: { X1_TEST_LINES_KEY: `${sentinel()}\n${sentinel()}`, X1_TEST_KEPT_KEY: sentinel() } });
  const { h, file } = run;
  const before = storeImage(h);
  saveAndSettle(run, `${fs.readFileSync(file, 'utf8')}# a note\n`);
  assert.equal(storeImage(h), before);
  assert.equal(h.store.removes, 0);
});

test('row 9: a key added elsewhere while the tab is open is never deleted by it', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  const added = sentinel();
  h.store.writeAll(new Map([['X1_TEST_NEW_KEY', added]]));
  saveAndSettle(run, without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY'));
  assert.equal(h.store.peek('X1_TEST_NEW_KEY'), added);
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), undefined, 'the listed key whose line was deleted still goes');
  assert.equal(h.store.removes, 1);
});

test('row 11: done applies an unapplied save, removals included, then ends with no question', async (t) => {
  const h = harness(t, { values: KEYS() });
  await h.run('edit');
  const file = editFile(h.paths);
  save(file, without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY'));
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m);
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), undefined);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(editFiles(h.paths), [], 'the edit ended');
});

test('row 12: done after a refused save repeats the refusal and keeps the edit open', async (t) => {
  const h = harness(t, { values: KEYS() });
  await h.run('edit');
  const file = editFile(h.paths);
  save(file, `${without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY')}not a line\n`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const done = await h.run('apply');
    assert.equal(done.code, 1);
    assert.match(done.stderr, /Nothing was saved/);
  }
  assert.ok(fs.existsSync(file));
  assert.equal(h.store.removes, 0);
  assert.ok(h.store.peek('X1_TEST_GONE_KEY'));
});

test('row 13: an edit opened by an earlier version with marked keys: the file wins at done', async (t) => {
  for (const [label, elsewhere, gone] of [
    ['marked line still deleted', () => {}, true],
    ['marked key changed elsewhere', (h) => h.store.writeAll(new Map([['X1_TEST_GONE_KEY', sentinel()]])), false],
  ]) {
    await t.test(label, async (t) => {
      const h = harness(t, { values: KEYS() });
      await h.run('edit');
      const file = editFile(h.paths);
      // What an earlier version left: the line deleted and handled, its key only marked.
      save(file, without(fs.readFileSync(file, 'utf8'), 'X1_TEST_GONE_KEY'));
      const state = editState(h.paths);
      const handled = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      fs.writeFileSync(path.join(h.paths.editDir, 'session.json'), JSON.stringify({ ...state, handled, pending: ['X1_TEST_GONE_KEY'] }));
      elsewhere(h);
      const done = await h.run('apply');
      assert.deepEqual(h.asked, []);
      assert.equal(h.store.peek('X1_TEST_GONE_KEY') === undefined, gone);
      if (gone) { assert.equal(done.code, 0, done.stderr); assert.match(done.stdout, /^removed: X1_TEST_GONE_KEY$/m); }
      else { assert.equal(done.code, 1); assert.match(done.stderr, /Your keys changed while this tab was open/); }
    });
  }
});

// The file's own notes under its status line: `#  > line N: why`, names only.
function details(text) {
  return text.split(/\r?\n/).filter((line) => line.startsWith('#  > ')).map((line) => {
    const match = /^#  > (?:line (\d+): )?(.*)$/.exec(line);
    return { line: match[1] ? Number(match[1]) : null, why: match[2] };
  });
}

// The 1-based line of `text` that starts with `start`.
function lineOf(text, start) { return text.split(/\r?\n/).findIndex((line) => line.startsWith(start)) + 1; }

function currentFile(h) { return path.join(h.paths.editDir, `env-edit-${editState(h.paths).id}.env`); }

// Every header and note line holds names only.
function noValuesInNotes(text, ...values) {
  const notes = text.split(/\r?\n/).filter((line) => line.startsWith('#')).join('\n');
  for (const value of values) assert.ok(!notes.includes(value), 'a note never holds a value');
}

test('row 6: an empty line for a stored key keeps its value; the other lines apply and the file says which line was skipped', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  const gone = h.store.peek('X1_TEST_GONE_KEY');
  const added = sentinel();
  saveAndSettle(run, `${fs.readFileSync(file, 'utf8').replace(/^X1_TEST_GONE_KEY=.*$/m, 'X1_TEST_GONE_KEY=')}X1_TEST_ADDED_KEY=${added}\n`);
  assert.equal(h.store.peek('X1_TEST_GONE_KEY'), gone, 'the stored value is kept');
  assert.equal(h.store.peek('X1_TEST_ADDED_KEY'), added, 'the other lines are applied');
  assert.equal(h.store.removes, 0, 'an empty line is not a delete');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# Status: saved \(\d\d:\d\d UTC\)\. Skipped the empty line below\.\r?$/m);
  assert.deepEqual(details(text), [{ line: lineOf(text, 'X1_TEST_GONE_KEY='), why: 'X1_TEST_GONE_KEY has no value, so it was skipped: nothing stored or changed for it' }]);
  noValuesInNotes(text, gone, added);
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^added: X1_TEST_ADDED_KEY$/m);
  assert.doesNotMatch(done.stdout, /X1_TEST_GONE_KEY/);
});

test('row 7: an empty line for a new name is a placeholder: nothing stored, kept in the next tab, and filled or dropped later', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  const fresh = sentinel();
  saveAndSettle(run, `${fs.readFileSync(file, 'utf8').replace(/^X1_TEST_KEPT_KEY=.*$/m, `X1_TEST_KEPT_KEY=${fresh}`)}X1_TEST_LATER_KEY=\n`);
  assert.equal(h.store.peek('X1_TEST_LATER_KEY'), undefined, 'nothing stored');
  assert.equal(h.store.peek('X1_TEST_KEPT_KEY'), fresh, 'the other lines are applied');
  const text = fs.readFileSync(file, 'utf8');
  assert.deepEqual(details(text), [{ line: lineOf(text, 'X1_TEST_LATER_KEY='), why: 'X1_TEST_LATER_KEY has no value, so it was skipped: nothing stored or changed for it' }]);
  const record = JSON.parse(fs.readFileSync(h.paths.manifest, 'utf8'));
  assert.ok(record.layout.includes('X1_TEST_LATER_KEY'), 'the placeholder stays in the layout');
  assert.match((await h.run('status')).stdout, /^ {2}X1_TEST_LATER_KEY: no value yet \(an empty line in your edit file\)$/m);
  assert.equal((await h.run('apply')).code, 0);
  // The next tab shows the placeholder again, where it was.
  await h.run('edit');
  const next = editFile(h.paths);
  assert.match(fs.readFileSync(next, 'utf8'), /^X1_TEST_LATER_KEY=\r?$/m);
  // Filling it stores the key like any new line.
  const later = sentinel();
  save(next, fs.readFileSync(next, 'utf8').replace(/^X1_TEST_LATER_KEY=$/m, `X1_TEST_LATER_KEY=${later}`));
  const filled = await h.run('apply');
  assert.match(filled.stdout, /^added: X1_TEST_LATER_KEY$/m);
  assert.equal(h.store.peek('X1_TEST_LATER_KEY'), later);
  assert.ok(!JSON.parse(fs.readFileSync(h.paths.manifest, 'utf8')).names.X1_TEST_LATER_KEY.placeholder);
  // A placeholder whose line is deleted is gone from the record and the next tab.
  await h.run('edit');
  const third = editFile(h.paths);
  save(third, `${fs.readFileSync(third, 'utf8')}X1_TEST_SOON_KEY=\n`);
  assert.equal((await h.run('apply')).code, 0);
  await h.run('edit');
  const fourth = editFile(h.paths);
  save(fourth, without(fs.readFileSync(fourth, 'utf8'), 'X1_TEST_SOON_KEY'));
  assert.equal((await h.run('apply')).code, 0);
  const after = JSON.parse(fs.readFileSync(h.paths.manifest, 'utf8'));
  assert.ok(!('X1_TEST_SOON_KEY' in after.names) && !after.layout.includes('X1_TEST_SOON_KEY'));
  await h.run('edit');
  assert.doesNotMatch(fs.readFileSync(editFile(h.paths), 'utf8'), /X1_TEST_SOON_KEY/);
  assert.equal(h.store.removes, 0);
});

test('a refused save lists each problem under the status line, by its line number in the file as written', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  saveAndSettle(run, `${fs.readFileSync(file, 'utf8')}not a line\nbad_name_here=x\nX1_TEST_QUOTE_KEY="quoted"\n`);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. Fix the lines below, then save again\.\r?$/m);
  const notes = details(text);
  assert.deepEqual(notes.map((note) => note.line), [lineOf(text, 'not a line'), lineOf(text, 'bad_name_here='), lineOf(text, 'X1_TEST_QUOTE_KEY=')]);
  assert.match(notes[0].why, /^not NAME=value$/);
  assert.match(notes[1].why, /^the text before = is not a valid key name/);
  assert.match(notes[2].why, /^remove the quotes around the value$/);
  assert.ok(!text.includes('bad_name_here=x\n#'), 'the names before = are never repeated in a note');
  const done = await h.run('apply');
  assert.equal(done.code, 1);
  for (const note of notes) assert.match(done.stderr, new RegExp(`line ${note.line}: `), 'done gives the same line numbers');
  // A file with no status line gets one at the top, and the numbers still count the file as written.
  save(file, 'not a line\n');
  assert.equal((await h.run('apply')).code, 1);
  const bare = fs.readFileSync(file, 'utf8');
  assert.deepEqual(details(bare), [{ line: lineOf(bare, 'not a line'), why: 'not NAME=value' }]);
  assert.equal(lineOf(bare, 'not a line'), 3);
  assert.equal(h.store.removes, 0);
});

test('row 10: a save in an older tab is refused in that tab, and its typing is kept until the next done after it was shown', async (t) => {
  for (const shownFirst of [true, false]) {
    await t.test(shownFirst ? 'shown by status, then done' : 'first shown by done', async (t) => {
      const cleaned = [];
      const run = await opened(t, { cleanCopies: (options) => { cleaned.push(options || {}); return 0; } });
      const { h } = run;
      const older = run.file;
      const text = fs.readFileSync(older, 'utf8');
      assert.equal((await h.run('apply')).code, 0, 'the edit ends and its file is wiped');
      await h.run('edit');
      const current = currentFile(h);
      // The editor brings the ended tab back, and the owner types in it and saves.
      const typed = sentinel();
      save(older, text.replace(/^X1_TEST_KEPT_KEY=.*$/m, `X1_TEST_KEPT_KEY=${typed}`));
      const before = storeImage(h);
      const watcher = h.env.editWatcher(current, { pid: 813, alive: () => true });
      watcher.start();
      watcher.tick();
      assert.equal(storeImage(h), before, 'nothing written');
      assert.equal(h.store.removes, 0, 'nothing deleted');
      assert.ok(fs.existsSync(older), 'the typing is kept');
      const content = fs.readFileSync(older, 'utf8');
      assert.match(content, /^# Status: NOT SAVED \(\d\d:\d\d UTC\)\. This is an older Toolkit env tab: only your current tab is saved\./m);
      assert.deepEqual(details(content), [{ line: lineOf(content, 'X1_TEST_KEPT_KEY='), why: 'X1_TEST_KEPT_KEY differs from what is stored' }]);
      noValuesInNotes(content, typed);
      watcher.tick();
      assert.equal(fs.readFileSync(older, 'utf8'), content, 'the note is written once per save, so it never fights the editor');
      const shown = /An older Toolkit env tab was not saved: its line for X1_TEST_KEPT_KEY differs from what is stored\./;
      if (shownFirst) assert.match((await h.run('status')).stdout, shown);
      const done = await h.run('apply');
      assert.equal(done.code, 0, done.stderr);
      if (shownFirst) {
        assert.match(done.stdout, /Deleted an older Toolkit env tab you were shown; its line for X1_TEST_KEPT_KEY was never saved\./);
        assert.deepEqual(editFiles(h.paths), []);
      } else {
        assert.match(done.stdout, shown);
        assert.ok(fs.existsSync(older), 'kept until the next done');
        assert.ok(cleaned.some((options) => (options.keep || []).includes(older)), 'its editor copies are kept');
        const next = await h.run('apply');
        assert.match(next.stdout, /Deleted an older Toolkit env tab you were shown/);
        assert.deepEqual(editFiles(h.paths), []);
      }
      assert.equal(storeImage(h), before);
      assert.equal(h.store.removes, 0);
    });
  }
  // An older tab whose lines all match the store holds nothing to lose: it is wiped at once.
  const run = await opened(t);
  const text = fs.readFileSync(run.file, 'utf8');
  await run.h.run('apply');
  await run.h.run('edit');
  save(run.file, text);
  await run.h.run('status');
  assert.equal(fs.existsSync(run.file), false);
});

test('row 14: edit while an edit is open reopens the same tab, applying a waiting save first', async (t) => {
  const added = sentinel();
  for (const [label, prepare, check] of [
    ['last save applied', async () => {}, () => {}],
    ['a save not applied yet', async (h, file) => { save(file, `${fs.readFileSync(file, 'utf8')}X1_TEST_ADDED_KEY=${added}\n`); }, (h) => assert.equal(h.store.peek('X1_TEST_ADDED_KEY'), added)],
    ['last save refused', async (h, file) => { save(file, `${fs.readFileSync(file, 'utf8')}not a line\n`); assert.equal((await h.run('apply')).code, 1); },
      (h, file, out) => { assert.match(out, /Your last save was not applied; the tab says why at the top\./); assert.match(fs.readFileSync(file, 'utf8'), /^not a line\r?$/m); }],
  ]) {
    await t.test(label, async (t) => {
      const opens = [];
      const h = harness(t, { values: KEYS(), opener: async (file) => { opens.push(file); return true; } });
      await h.run('edit');
      const { id } = editState(h.paths);
      const file = currentFile(h);
      await prepare(h, file);
      const before = fs.readFileSync(file, 'utf8');
      const again = await h.run('edit');
      assert.equal(again.code, 0, again.stderr);
      assert.equal(editState(h.paths).id, id, 'the same edit');
      assert.deepEqual(editFiles(h.paths), [path.basename(file)], 'no new tab, nothing wiped');
      assert.deepEqual(opens, [file, file], 'the same file is opened again');
      assert.match(again.stdout, /^Opening ~\/\.ai-agent-toolkit\/env\/edit\/env-edit-[0-9a-f]{16}\.env again: your edit is still open, so this is the same tab\./m);
      assert.ok(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => !line.startsWith('#')).join('\n')
        === before.split(/\r?\n/).filter((line) => !line.startsWith('#')).join('\n'), 'what was typed is untouched');
      check(h, file, again.stdout);
      assert.equal(h.store.removes, 0);
    });
  }
});

test('row 15: edit with no edit open makes a new tab', async (t) => {
  const h = harness(t, { values: KEYS() });
  const first = await h.run('edit');
  assert.match(first.stdout, /^Opening ~\/\.ai-agent-toolkit\/env\/edit\/env-edit-[0-9a-f]{16}\.env with your 3 keys\./m);
  const { id } = editState(h.paths);
  await h.run('apply');
  await h.run('edit');
  assert.notEqual(editState(h.paths).id, id);
  assert.equal(h.store.removes, 0);
});

test('rows 16 and 17: the 30-minute close wipes a handled tab, applies a waiting save first, and keeps a refused tab as an older tab', async (t) => {
  const added = sentinel();
  for (const [label, prepare, expect] of [
    ['last save handled', async () => {}, { kept: false, out: /Closed your env edit 30 minutes after its last save\./ }],
    ['a save not applied yet', async (h, file) => save(file, `${fs.readFileSync(file, 'utf8')}X1_TEST_ADDED_KEY=${added}\n`), { kept: false, added: true }],
    ['last save refused', async (h, file) => { save(file, `X1_TEST_ADDED_KEY=${added}\n${fs.readFileSync(file, 'utf8')}not a line\n`); assert.equal((await h.run('apply')).code, 1); },
      { kept: true, out: /Closed your env edit 30 minutes after its last save; its last save was not applied, so the tab is kept as an older tab\./ }],
  ]) {
    await t.test(label, async (t) => {
      const clock = clockAt();
      const h = harness(t, { clock, values: KEYS() });
      await h.run('edit');
      const file = currentFile(h);
      await prepare(h, file);
      clock.ms += 31 * 60 * 1000;
      const status = await h.run('status');
      if (expect.out) assert.match(status.stdout, expect.out);
      assert.equal(fs.existsSync(file), expect.kept);
      assert.equal(h.store.peek('X1_TEST_ADDED_KEY') === added, Boolean(expect.added));
      if (expect.kept) {
        assert.match(status.stdout, /An older Toolkit env tab was not saved: its line for X1_TEST_ADDED_KEY differs from what is stored\./);
        assert.match(fs.readFileSync(file, 'utf8'), /^not a line\r?$/m, 'the typing is kept');
        assert.match((await h.run('apply')).stdout, /Deleted an older Toolkit env tab you were shown/);
        assert.equal(fs.existsSync(file), false);
      }
      assert.equal(h.store.removes, 0);
    });
  }
});

test('23 Nov lost save: the agent asks for the keys again while the owner types, and the owner\'s save still lands', async (t) => {
  const run = await opened(t);
  const { h, file } = run;
  // The owner is typing in the tab (not saved yet) when the agent runs edit again.
  const again = await h.run('edit');
  assert.equal(again.code, 0, again.stderr);
  assert.equal(currentFile(h), file, 'still the same tab');
  // A second helper start finds the live one and stops; the first keeps watching.
  assert.equal(h.env.editWatcher(file, { pid: 814, alive: () => true }).start(), false);
  const typed = sentinel();
  saveAndSettle(run, `${fs.readFileSync(file, 'utf8')}X1_TEST_TYPED_KEY=${typed}\nX1_TEST_LATER_KEY=\n`);
  assert.equal(h.store.peek('X1_TEST_TYPED_KEY'), typed, 'the save is applied');
  const text = fs.readFileSync(file, 'utf8');
  assert.deepEqual(details(text).map((note) => note.line), [lineOf(text, 'X1_TEST_LATER_KEY=')], 'the empty line is shown in the tab, not only at done');
  const done = await h.run('apply');
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /^added: X1_TEST_TYPED_KEY$/m);
  assert.equal(h.store.removes, 0);
});

test('row 18: every other command deletes nothing', async (t) => {
  const runs = {
    status: (h) => h.run('status'),
    help: (h) => h.run('help'),
    edit: (h) => h.run('edit'),
    set: (h) => h.run('set', 'X1_TEST_SET_KEY'),
    show: (h) => h.run('show', 'X1_TEST_KEPT_KEY'),
    header: (h) => h.run('header', 'X1_TEST_KEPT_KEY'),
    run: (h) => h.run('run', '--names', 'X1_TEST_KEPT_KEY', '--', process.execPath, '-e', '0'),
    connect: (h) => h.run('connect', 'coolify', '--name', 'X1_TEST_KEPT_KEY'),
    revoke: (h) => h.run('revoke', '--feeders'),
    'import-codex-env': (h) => h.run('import-codex-env'),
    'retire-codex-env': (h) => h.run('retire-codex-env'),
    'watch with no new save': async (h, clock) => {
      const watcher = h.env.editWatcher(editFile(h.paths), { pid: 812, alive: () => true });
      watcher.start();
      for (let tick = 0; tick < 4; tick += 1) { watcher.tick(); clock.ms += 1000; }
      return { code: 0 };
    },
  };
  for (const [label, command] of Object.entries(runs)) {
    await t.test(label, async (t) => {
      const clock = clockAt();
      const values = KEYS();
      const h = harness(t, { clock, values, hidden: [sentinel()], enters: [true], answers: ['yes'], clipboard: () => true });
      await h.run('edit');
      await command(h, clock);
      assert.equal(h.store.removes, 0, label);
      for (const name of Object.keys(values)) assert.ok(h.store.peek(name), `${label} kept ${name}`);
    });
  }
});

test('row 19: remove is not a command, and the store is untouched', async (t) => {
  const h = harness(t, { values: KEYS(), answers: ['yes'] });
  const before = storeImage(h);
  const result = await h.run('remove', 'X1_TEST_GONE_KEY');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /That is not a toolkit env command/);
  assert.equal(storeImage(h), before);
  assert.equal(h.store.removes, 0);
  assert.deepEqual(h.asked, []);
  const help = (await h.run('help')).stdout;
  assert.doesNotMatch(help, /^\s+remove\b/m, 'no remove command in help');
  assert.match(help, /deleting a line removes that key \(the only way to remove one\)/);
});

function scriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? scriptFiles(full) : [full];
  });
}

test('row 20: the store\'s delete has one call site, in the edit-file save; remove toolkit, setup and the rest never reach it', () => {
  const store = require('../scripts/toolkit-env-store.cjs');
  assert.equal('remove' in store.WindowsCredentialStore.prototype, false, 'no general delete method');
  assert.equal('remove' in store.PlatformStore.prototype, false);
  const calls = [];
  for (const file of scriptFiles(SCRIPTS)) {
    // Line ends as LF (a Windows checkout has CRLF); comment lines blanked (same length), so only code counts.
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, (line) => ' '.repeat(line.length));
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const match of text.matchAll(/removeForEditSave\(/g)) calls.push({ relative, at: match.index, text });
    if (relative !== 'repo/scripts/toolkit-env-store.cjs') {
      assert.doesNotMatch(text, /CredDelete/, relative);
      assert.doesNotMatch(text, /op:\s*'delete'/, relative);
    }
    assert.doesNotMatch(text, /cmdkey[^\n]*\/del/i, relative);
  }
  const outside = calls.filter((call) => call.relative !== 'repo/scripts/toolkit-env-store.cjs');
  assert.deepEqual(outside.map((call) => call.relative), ['repo/scripts/toolkit-env.cjs'], 'one call site outside the store');
  const source = outside[0].text;
  const start = source.indexOf('  #checkSave(');
  const end = source.indexOf('\n  }\n', start);
  assert.ok(start !== -1 && outside[0].at > start && outside[0].at < end, 'the call is inside the edit-file save');
  // The store module defines it twice (the Credential Manager store and the platform wrapper) and calls it once (the wrapper).
  assert.equal(calls.filter((call) => call.relative === 'repo/scripts/toolkit-env-store.cjs').length, 3);
  // remove toolkit keeps the keys and the env folder, and says so.
  const remove = fs.readFileSync(path.join(SCRIPTS, 'toolkit-remove.cjs'), 'utf8');
  assert.match(remove, /const NOT_TOUCHED = 'Not touched: your repositories, your keys \(the env store and the credential store\)/);
  assert.match(fs.readFileSync(path.join(SCRIPTS, 'toolkit-remove-parts.cjs'), 'utf8'), /const KEPT_ENTRIES = Object\.freeze\(\['env', 'backups'\]\);/);
});

test('row 21: in a test run the store refuses the real key store before PowerShell starts', async (t) => {
  const spawned = [];
  const spy = (...call) => { spawned.push(call); return { status: 0, stdout: '{"ok":true,"answers":[{"code":0,"targets":[]}]}' }; };
  const refused = (error) => error.code === 'test-run' && /does not use your real key store during a test run/.test(error.message);
  for (const options of [{ spawn: spy }, { spawn: spy, environment: {} }, { spawn: spy, prefix: STORE_PREFIX }, { spawn: spy, prefix: `${STORE_PREFIX.toUpperCase()}/` }]) {
    const store = new WindowsCredentialStore(options);
    assert.throws(() => store.list(), refused);
    assert.throws(() => store.readAll(['X1_TEST_KEPT_KEY']), refused);
    assert.throws(() => store.writeAll(new Map([['X1_TEST_KEPT_KEY', 'x']])), refused);
    assert.throws(() => store.removeForEditSave('X1_TEST_KEPT_KEY'), refused);
  }
  assert.throws(() => new PlatformStore({ platform: 'win32', options: { spawn: spy } }).list(), refused);
  assert.equal(spawned.length, 0, 'PowerShell never started');
  assert.deepEqual(new WindowsCredentialStore({ prefix: 'ai-agent-toolkit-test/guard', spawn: spy }).list(), [], 'a test prefix still works');
  assert.equal(spawned.length, 1);
  // The real command in a child of this test run stops the same way (only checked once the guard above held).
  if (process.platform === 'win32') {
    const home = tempHome(t);
    const child = spawnSync(process.execPath, [SCRIPT, 'status'], { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } });
    assert.equal(child.status, 1, child.stdout);
    assert.match(child.stderr, /does not use your real key store during a test run/);
  }
});

test('row 21: every test that starts the real toolkit env command keeps the test-run marker in its environment', () => {
  const found = [];
  for (const file of scriptFiles(TESTS).filter((name) => name.endsWith('.cjs'))) {
    const text = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const match of text.matchAll(/\b(?:spawnSync|spawn|execFileSync|execFile|fork)\(([^;]*?)\);/gs)) {
      const call = match[1];
      if (!/\bSCRIPT\b/.test(call) || !/toolkit-env\.cjs/.test(text.match(/const SCRIPT = [^\n]*/)?.[0] || '')) continue;
      found.push(relative);
      const env = /\benv:\s*(\{\s*\.\.\.\s*)?([A-Za-z_.]+)/.exec(call);
      if (!env) continue; // inherits this process's environment, marker included
      const source = env[2];
      const fromProcess = source === 'process.env'
        || new RegExp(`const ${source.replace('.', '\\.')} = [^\\n]*process\\.env`).test(text);
      assert.ok(fromProcess, `${relative}: a toolkit env child gets an environment built from process.env, so the test-run marker reaches it`);
    }
  }
  assert.ok(found.length >= 5, 'the scan found the known real-command tests');
});
