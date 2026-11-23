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
    ['secret-like comment', '# token sk-abcdefghijklmnopqrstuvwxyz0123\n'],
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
    // Comment lines are blanked (same length), so only code counts.
    const text = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, (line) => ' '.repeat(line.length));
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
