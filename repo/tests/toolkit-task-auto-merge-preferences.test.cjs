'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SCHEMA, TaskAutoMergePreferences } = require('../scripts/toolkit-task-auto-merge-preferences.cjs');

function fixture(t, host = 'codex', fileSystem = fs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-merge-preferences-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host}.v1.json`);
  return { home, file, owner: new TaskAutoMergePreferences({ home, host, fileSystem }) };
}

for (const host of ['codex', 'claude-code']) {
  test(`${host}: missing, Current, On and Off have exact effects`, t => {
    const { owner, file } = fixture(t, host);
    const missing = owner.inspect();
    assert.equal(missing.status, 'missing');
    assert.equal(missing.value, 'off');
    assert.equal(owner.apply('keep', missing).changed, false);
    assert.equal(fs.existsSync(file), false);
    for (const value of ['after-gates', 'off']) {
      const result = owner.apply(value, owner.inspect());
      assert.equal(result.value, value);
      assert.deepEqual(JSON.parse(fs.readFileSync(file)), { schema: SCHEMA, host, value });
      const before = fs.readFileSync(file);
      assert.equal(owner.apply('keep', owner.inspect()).changed, false);
      assert.deepEqual(fs.readFileSync(file), before);
    }
  });

  test(`${host}: malformed, oversized and unknown records stop before writing`, t => {
    const { owner, file } = fixture(t, host);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const record of ['not json', 'x'.repeat(4097), 'null', '[]',
      ...[
        { schema: SCHEMA, host, value: 'on' }, { schema: 'unknown', host, value: 'after-gates' },
        { schema: SCHEMA, host: 'other', value: 'after-gates' },
        { schema: SCHEMA, host, value: 'after-gates', extra: true },
        { schema: SCHEMA, host },
      ].map(JSON.stringify)]) {
      fs.writeFileSync(file, record);
      const state = owner.inspect();
      assert.equal(state.status, 'blocked', record);
      assert.equal(state.value, 'off');
      for (const answer of ['keep', 'off', 'after-gates']) assert.throws(() => owner.apply(answer, state), /blocked/);
      assert.equal(fs.readFileSync(file, 'utf8'), record);
    }
  });
}

test('only the selected trusted host file is ever read', t => {
  const { home, owner } = fixture(t);
  owner.apply('after-gates', owner.inspect());
  const reads = [];
  const fileSystem = { ...fs, lstatSync(file) { reads.push(file); return fs.lstatSync(file); } };
  const other = new TaskAutoMergePreferences({ home, host: 'claude-code', fileSystem });
  assert.equal(other.inspect().value, 'off');
  assert.ok(reads.every(file => file.endsWith('task-auto-merge.claude-code.v1.json')));
  reads.length = 0;
  const unknown = new TaskAutoMergePreferences({ home, host: '../../codex', fileSystem });
  assert.equal(unknown.inspect().status, 'blocked');
  assert.deepEqual(reads, []);
});

test('stale bytes, even with the same value, invalidate an approved bank; lock contention refuses', t => {
  const { owner, file } = fixture(t);
  owner.apply('off', owner.inspect());
  const before = owner.inspect();
  fs.appendFileSync(file, ' ');
  assert.throws(() => owner.apply('after-gates', before), /changed/);
  fs.writeFileSync(`${file}.lock`, 'other writer');
  assert.throws(() => owner.apply('after-gates', owner.inspect()), /blocked/);
  assert.equal(owner.inspect().status, 'blocked');
  assert.equal(owner.inspect().value, 'off');
});

for (const existing of [false, true]) {
  for (const failure of ['write', 'rename', 'read-back']) {
    test(`${failure}, previous record ${existing ? 'present' : 'missing'}: previous bytes restored`, t => {
      const { home, file, owner } = fixture(t);
      if (existing) owner.apply('off', owner.inspect());
      const before = existing ? fs.readFileSync(file) : null;
      let fail = true;
      let renamed = false;
      const fileSystem = {
        ...fs,
        writeFileSync(target, ...args) {
          if (failure === 'write' && String(target).endsWith('.tmp') && fail) { fail = false; throw new Error('write failed'); }
          return fs.writeFileSync(target, ...args);
        },
        renameSync(from, to) {
          if (failure === 'rename' && fail) { fail = false; throw new Error('rename failed'); }
          const result = fs.renameSync(from, to); renamed = true; return result;
        },
        readFileSync(target, ...args) {
          if (failure === 'read-back' && renamed && target === file && fail) { fail = false; throw new Error('read failed'); }
          return fs.readFileSync(target, ...args);
        },
      };
      const writer = new TaskAutoMergePreferences({ home, host: 'codex', fileSystem });
      assert.throws(() => writer.apply('after-gates', writer.inspect()), failure === 'read-back' ? /restored and read back/ : /failed/);
      if (before === null) assert.equal(fs.existsSync(file), false);
      else assert.deepEqual(fs.readFileSync(file), before);
      assert.equal(fs.existsSync(`${file}.lock`), false);
      assert.ok(fs.readdirSync(path.dirname(file)).every(name => !name.endsWith('.tmp')));
    });
  }
}

test('concurrent changes during read-back are retained, with a recovery copy of previous bytes', t => {
  const { home, file, owner } = fixture(t);
  owner.apply('off', owner.inspect());
  const before = fs.readFileSync(file);
  let written = false;
  let concurrent = false;
  const writer = new TaskAutoMergePreferences({ home, host: 'codex', fileSystem: {
    ...fs,
    renameSync(from, to) { fs.renameSync(from, to); written = true; },
    readFileSync(target, ...args) {
      if (target === file && written && !concurrent) { concurrent = true; fs.writeFileSync(file, 'concurrent edit'); }
      return fs.readFileSync(target, ...args);
    },
  } });
  assert.throws(() => writer.apply('after-gates', writer.inspect()), /restoration could not be verified/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent edit');
  assert.equal(owner.inspect().status, 'blocked', 'failed restore retains the hold');
  const backup = fs.readdirSync(path.dirname(file)).find(name => name.includes('.recovery-'));
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), backup)), before);
});

test('read-back and restore failure keep automatic merging blocked and preserve recovery bytes', t => {
  const { home, file, owner } = fixture(t);
  owner.apply('off', owner.inspect());
  const before = fs.readFileSync(file);
  let renames = 0;
  let failRead = true;
  const writer = new TaskAutoMergePreferences({ home, host: 'codex', fileSystem: {
    ...fs,
    renameSync(from, to) {
      if (++renames === 2) throw new Error('restore failed');
      return fs.renameSync(from, to);
    },
    readFileSync(target, ...args) {
      if (target === file && renames === 1 && failRead) { failRead = false; throw new Error('read-back failed'); }
      return fs.readFileSync(target, ...args);
    },
  } });
  assert.throws(() => writer.apply('after-gates', writer.inspect()), /restoration could not be verified/);
  assert.equal(owner.inspect().status, 'blocked');
  const backup = fs.readdirSync(path.dirname(file)).find(name => name.includes('.recovery-'));
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), backup)), before);
});

test('another reader is blocked while a write awaits read-back', t => {
  const { home, file, owner } = fixture(t);
  let observed = null;
  const writer = new TaskAutoMergePreferences({ home, host: 'codex', fileSystem: {
    ...fs,
    renameSync(from, to) { fs.renameSync(from, to); if (to === file) observed = owner.inspect(); },
  } });
  writer.apply('after-gates', writer.inspect());
  assert.equal(observed.status, 'blocked');
  assert.equal(owner.inspect().value, 'after-gates');
});

test('invalid choices and host are rejected without a write', t => {
  const { owner, home } = fixture(t);
  for (const value of ['on', 'yes', true, null, 'after-gates ']) assert.throws(() => owner.apply(value, owner.inspect()), /Invalid/);
  const unknown = new TaskAutoMergePreferences({ host: null, home });
  assert.throws(() => unknown.apply('after-gates', unknown.inspect()), /blocked/);
  assert.deepEqual(fs.readdirSync(home), []);
});
