'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ClaudeUserSettings, SETTINGS, STATES } = require('../scripts/toolkit-claude-user-settings.cjs');

function fixture(t, initial) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-claude-user-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  if (initial !== undefined) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(settingsPath, typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`);
  }
  const owner = new ClaudeUserSettings({ environment: { CLAUDE_CONFIG_DIR: configDir }, controlRoot: path.join(root, 'control') });
  const read = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
  return { owner, settingsPath, read, recordPath: path.join(root, 'control', 'claude-user-settings.json') };
}
const byId = (results) => Object.fromEntries(results.map((result) => [result.id, result]));
// The three settings whose Turn off removes the line; the model-switch setting writes false instead.
const REMOVABLE = ['attribution', 'cross-session-inbound', 'agents-md'];
const removable = (choice) => Object.fromEntries(REMOVABLE.map((id) => [id, choice]));

test('the four selected Toolkit settings keep their projection shapes; host validity still needs UAT', () => {
  assert.deepEqual(SETTINGS.map((spec) => [spec.keyPath.join('.'), spec.value, spec.offValue]), [
    ['attribution', false, undefined],
    ['crossSessionInbound', 'accept', undefined],
    ['switchModelsOnFlag', true, false],
    ['pluginConfigs.cc-plugin-agents-md@builtin.options.instructionFiles', 'claude-md-and-agents-md', undefined]
  ]);
});

test('the model-switch setting is on when missing or true; Turn off writes false and Turn on writes true', (t) => {
  const { owner, read, settingsPath, recordPath } = fixture(t, { theme: 'dark' });
  const missing = byId(owner.inspect())['switch-models-on-flag'];
  assert.equal(missing.state, STATES.DEFAULT);
  const before = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(byId(owner.apply({ 'switch-models-on-flag': 'enable' }))['switch-models-on-flag'].changed, false, 'missing is on already');
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);

  const off = byId(owner.apply({ 'switch-models-on-flag': 'disable' }))['switch-models-on-flag'];
  assert.deepEqual([off.status, off.changed, off.state], ['off', true, STATES.OFF]);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false });
  assert.deepEqual(byId(owner.inspect())['switch-models-on-flag'], { id: 'switch-models-on-flag', label: SETTINGS[2].label, state: STATES.OFF, value: false, toolkit: true });
  assert.equal(byId(owner.apply({ 'switch-models-on-flag': 'disable' }))['switch-models-on-flag'].changed, false, 'off already');
  assert.equal(byId(owner.apply({ 'switch-models-on-flag': 'keep' }))['switch-models-on-flag'].toolkit, true, 'keep leaves the record');

  const on = byId(owner.apply({ 'switch-models-on-flag': 'enable' }))['switch-models-on-flag'];
  assert.deepEqual([on.status, on.changed, on.state], ['set', true, STATES.TOOLKIT]);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: true });
  owner.apply({ 'switch-models-on-flag': 'disable' });
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false });
  assert.ok(fs.existsSync(recordPath));

  // A false you wrote yourself is off too; Turn off leaves it and Turn on replaces it.
  const yours = fixture(t, { switchModelsOnFlag: false });
  const state = byId(yours.owner.inspect())['switch-models-on-flag'];
  assert.deepEqual([state.state, state.toolkit], [STATES.OFF, false]);
  assert.equal(byId(yours.owner.apply({ 'switch-models-on-flag': 'disable' }))['switch-models-on-flag'].changed, false);
  yours.owner.apply({ 'switch-models-on-flag': 'enable' });
  assert.deepEqual(yours.read(), { switchModelsOnFlag: true });
});

test('enable writes every absent setting, keeps other keys, and disable removes exactly what Toolkit wrote', (t) => {
  const { owner, settingsPath, read, recordPath } = fixture(t, { permissions: { defaultMode: 'auto' }, pluginConfigs: { other: { options: { a: 1 } } } });
  const on = byId(owner.apply('enable'));
  for (const result of Object.values(on)) assert.equal(result.status, 'set');
  const settings = read();
  assert.equal(settings.attribution, false);
  assert.equal(settings.crossSessionInbound, 'accept');
  assert.equal(Object.hasOwn(settings, 'switchModelsOnFlag'), false, 'missing already means on');
  assert.equal(settings.pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'claude-md-and-agents-md');
  assert.deepEqual(settings.permissions, { defaultMode: 'auto' });
  assert.deepEqual(settings.pluginConfigs.other, { options: { a: 1 } });
  assert.deepEqual(owner.inspect().map((state) => state.state), [STATES.TOOLKIT, STATES.TOOLKIT, STATES.DEFAULT, STATES.TOOLKIT]);

  const off = owner.apply(removable('disable'));
  assert.ok(off.filter((result) => REMOVABLE.includes(result.id)).every((result) => result.status === 'claude-default'));
  assert.deepEqual(read(), { permissions: { defaultMode: 'auto' }, pluginConfigs: { other: { options: { a: 1 } } } });
  assert.equal(fs.existsSync(recordPath), false, 'no empty record is left behind');
  assert.ok(fs.existsSync(settingsPath));
});

test('keep never changes an owner value; enable leaves an equal one alone', (t) => {
  const { owner, settingsPath } = fixture(t, { crossSessionInbound: 'accept', attribution: { commit: '' } });
  const before = fs.readFileSync(settingsPath, 'utf8');
  const kept = byId(owner.apply('keep'));
  assert.equal(kept['cross-session-inbound'].status, 'kept');
  assert.equal(kept.attribution.status, 'kept');
  const on = byId(owner.apply({ 'cross-session-inbound': 'enable' }));
  assert.equal(on['cross-session-inbound'].status, 'set');
  assert.equal(on['cross-session-inbound'].changed, false);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'keep and an already-on enable write nothing');
});

test('disable removes an owner value whoever set it, equal or different, and only that key', (t) => {
  const { owner, read } = fixture(t, { theme: 'dark', crossSessionInbound: 'accept', attribution: true });
  const equal = byId(owner.apply({ 'cross-session-inbound': 'disable' }));
  assert.equal(equal['cross-session-inbound'].status, 'claude-default');
  assert.equal(equal['cross-session-inbound'].changed, true);
  assert.deepEqual(read(), { theme: 'dark', attribution: true });
  const different = byId(owner.apply({ attribution: 'disable' }));
  assert.equal(different.attribution.changed, true);
  assert.deepEqual(read(), { theme: 'dark' });
  assert.equal(byId(owner.apply({ attribution: 'disable' })).attribution.changed, false, 'already off changes nothing');
});

test('disable keeps parents and a file Toolkit did not create, even when they end up empty', (t) => {
  const { owner, settingsPath, read } = fixture(t, { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } } } });
  assert.equal(byId(owner.apply({ 'agents-md': 'disable' }))['agents-md'].changed, true);
  assert.deepEqual(read(), { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: {} } } });

  const solo = fixture(t, { attribution: false });
  solo.owner.apply({ attribution: 'disable' });
  assert.ok(fs.existsSync(solo.settingsPath), 'an owner file stays even when empty');
  assert.deepEqual(solo.read(), {});
  assert.ok(fs.existsSync(settingsPath));
});

test('enable replaces a different owner value, and a following disable removes it and a file Toolkit created', (t) => {
  const { owner, read, recordPath } = fixture(t, { crossSessionInbound: 'reject', theme: 'dark' });
  const on = byId(owner.apply({ 'cross-session-inbound': 'enable' }));
  assert.equal(on['cross-session-inbound'].status, 'set');
  assert.equal(on['cross-session-inbound'].changed, true);
  assert.deepEqual(read(), { crossSessionInbound: 'accept', theme: 'dark' });
  assert.equal(byId(owner.inspect())['cross-session-inbound'].state, STATES.TOOLKIT);
  const entry = Object.values(JSON.parse(fs.readFileSync(recordPath, 'utf8')).entries)[0];
  assert.deepEqual([entry.created_parents, entry.created_file], [[], false]);
  owner.apply({ 'cross-session-inbound': 'disable' });
  assert.deepEqual(read(), { theme: 'dark' });

  const created = fixture(t);
  created.owner.apply({ attribution: 'enable' });
  fs.writeFileSync(created.settingsPath, `${JSON.stringify({ attribution: false, crossSessionInbound: 'reject' }, null, 2)}\n`);
  created.owner.apply({ 'cross-session-inbound': 'enable' });
  created.owner.apply(removable('disable'));
  assert.equal(fs.existsSync(created.settingsPath), false, 'a Toolkit-created file goes once emptied');
});

test('a parent entry that is not an object holds that setting on enable and disable', (t) => {
  const { owner, settingsPath } = fixture(t, { pluginConfigs: 'x', theme: 'dark' });
  const before = fs.readFileSync(settingsPath, 'utf8');
  for (const choice of ['enable', 'disable']) {
    const result = byId(owner.apply({ 'agents-md': choice }))['agents-md'];
    assert.equal(result.status, 'held', choice);
    assert.equal(result.blocked, true, choice);
  }
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
});

test('an owner value reports whether it matches Toolkit\'s value; a blocked parent never matches', (t) => {
  const { owner } = fixture(t, { crossSessionInbound: 'accept', attribution: true, pluginConfigs: 'x' });
  const states = byId(owner.inspect());
  assert.equal(states['cross-session-inbound'].state, STATES.OWNER);
  assert.equal(states['cross-session-inbound'].matches, true);
  assert.equal(states.attribution.state, STATES.OWNER);
  assert.equal(states.attribution.matches, false);
  assert.equal(states.attribution.value, true);
  assert.equal(states['agents-md'].matches, false);
  assert.equal(states['switch-models-on-flag'].state, STATES.DEFAULT);
});

test('attribution hidden with the full object form counts as Toolkit\'s value; a partial object does not', (t) => {
  const full = { commit: '', pr: '', sessionUrl: false };
  for (const [label, value, matches] of [
    ['full object', full, true],
    ['full object with another key', { ...full, extra: 'x' }, true],
    ['commit only', { commit: '' }, false],
    ['commit and pr', { commit: '', pr: '' }, false],
    ['session link kept', { ...full, sessionUrl: true }, false],
    ['true', true, false],
  ]) {
    const { owner, read } = fixture(t, { attribution: value });
    const state = byId(owner.inspect()).attribution;
    assert.equal(state.state, STATES.OWNER, label);
    assert.equal(state.matches, matches, label);
    // A matching form is on already and is not rewritten; a different one is replaced. Disable removes either.
    const on = byId(owner.apply({ attribution: 'enable' })).attribution;
    assert.equal(on.changed, !matches, label);
    assert.deepEqual(read().attribution, matches ? value : false, label);
    assert.equal(byId(owner.apply({ attribution: 'disable' })).attribution.changed, true, label);
    assert.deepEqual(read(), {}, label);
  }
});

test('per-setting choices touch only the named settings; a setting left out is kept', (t) => {
  const { owner, read } = fixture(t, { theme: 'dark' });
  const first = byId(owner.apply({ 'switch-models-on-flag': 'disable' }));
  assert.equal(first['switch-models-on-flag'].status, 'off');
  for (const id of ['attribution', 'cross-session-inbound', 'agents-md']) assert.equal(first[id].status, 'kept', id);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false });

  owner.apply({ attribution: 'enable', 'cross-session-inbound': 'enable' });
  const removed = byId(owner.apply({ attribution: 'disable' }));
  assert.equal(removed.attribution.status, 'claude-default');
  assert.equal(removed.attribution.changed, true);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false, crossSessionInbound: 'accept' });
  assert.deepEqual(owner.inspect().map((state) => state.state), [STATES.DEFAULT, STATES.TOOLKIT, STATES.OFF, STATES.DEFAULT]);

  assert.throws(() => owner.apply({ 'not-a-setting': 'enable' }), /Unknown Claude setting: not-a-setting/);
  assert.throws(() => owner.apply({ attribution: 'maybe' }), /Unsupported Claude settings choice: maybe/);
  assert.throws(() => owner.apply('maybe'), /Unsupported Claude settings choice: maybe/);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false, crossSessionInbound: 'accept' }, 'a refused call writes nothing');
});

test('an owner edit after Toolkit wrote a value is removed on disable, keeping parents Toolkit did not record', (t) => {
  const { owner, settingsPath, read, recordPath } = fixture(t, {});
  owner.apply('enable');
  const edited = read();
  edited.crossSessionInbound = 'hold';
  edited.pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles = 'claude-md';
  fs.writeFileSync(settingsPath, `${JSON.stringify(edited, null, 2)}\n`);
  const results = byId(owner.apply(removable('disable')));
  assert.equal(results['cross-session-inbound'].changed, true);
  // The edited value is the owner's now, so the parents Toolkit once created stay and so does the file.
  assert.deepEqual(read(), { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: {} } } });
  assert.equal(fs.existsSync(recordPath), false);
});

test('a file Toolkit created is removed again when nothing else is left', (t) => {
  const { owner, settingsPath } = fixture(t);
  owner.apply('enable');
  assert.ok(fs.existsSync(settingsPath));
  owner.apply(removable('disable'));
  assert.equal(fs.existsSync(settingsPath), false);
  // Off for the model-switch setting is a value, so a file holding it stays.
  owner.apply({ 'switch-models-on-flag': 'disable' });
  owner.apply('enable');
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).switchModelsOnFlag, true);
});

test('invalid JSON is held unchanged and BOM and CRLF are preserved on write', (t) => {
  const bad = fixture(t, '{ not json');
  assert.ok(bad.owner.apply('enable').every((result) => result.status === 'held'));
  assert.equal(fs.readFileSync(bad.settingsPath, 'utf8'), '{ not json');

  const crlf = fixture(t, '﻿{\r\n  "theme": "dark"\r\n}\r\n');
  crlf.owner.apply('enable');
  const text = fs.readFileSync(crlf.settingsPath, 'utf8');
  assert.ok(text.startsWith('﻿{\r\n'));
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/);
  assert.equal(crlf.read().theme, 'dark');
});

test('a concurrent edit between read and write is refused and leaves no Toolkit record', (t) => {
  const { owner, settingsPath, recordPath } = fixture(t, { theme: 'dark' });
  const realRead = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', function patched(file, ...rest) {
    const value = realRead.call(fs, file, ...rest);
    if (path.resolve(String(file)) === path.resolve(settingsPath) && ++reads === 1) fs.writeFileSync(settingsPath, '{"theme":"light"}\n');
    return value;
  });
  assert.throws(() => owner.apply('enable'), /changed while setup was running/);
  t.mock.restoreAll();
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { theme: 'light' });
  const record = fs.existsSync(recordPath) ? JSON.parse(fs.readFileSync(recordPath, 'utf8')) : {};
  assert.equal(JSON.stringify(record).includes('attribution'), false, JSON.stringify(record));
});
