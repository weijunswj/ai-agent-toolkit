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

test('the four selected Toolkit settings keep their projection shapes; host validity still needs UAT', () => {
  assert.deepEqual(SETTINGS.map((spec) => [spec.keyPath.join('.'), spec.value]), [
    ['attribution', false],
    ['crossSessionInbound', 'accept'],
    ['switchModelsOnFlag', false],
    ['pluginConfigs.cc-plugin-agents-md@builtin.options.instructionFiles', 'claude-md-and-agents-md']
  ]);
});

test('enable writes every absent setting, keeps other keys, and disable removes exactly what Toolkit wrote', (t) => {
  const { owner, settingsPath, read, recordPath } = fixture(t, { permissions: { defaultMode: 'auto' }, pluginConfigs: { other: { options: { a: 1 } } } });
  const on = byId(owner.apply('enable'));
  for (const result of Object.values(on)) assert.equal(result.status, 'set');
  const settings = read();
  assert.equal(settings.attribution, false);
  assert.equal(settings.crossSessionInbound, 'accept');
  assert.equal(settings.switchModelsOnFlag, false);
  assert.equal(settings.pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'claude-md-and-agents-md');
  assert.deepEqual(settings.permissions, { defaultMode: 'auto' });
  assert.deepEqual(settings.pluginConfigs.other, { options: { a: 1 } });
  assert.ok(owner.inspect().every((state) => state.state === STATES.TOOLKIT));

  const off = owner.apply('disable');
  assert.ok(off.every((result) => result.status === 'claude-default'));
  assert.deepEqual(read(), { permissions: { defaultMode: 'auto' }, pluginConfigs: { other: { options: { a: 1 } } } });
  assert.equal(fs.existsSync(recordPath), false, 'no empty record is left behind');
  assert.ok(fs.existsSync(settingsPath));
});

test('an owner value is reported and never changed, on enable, disable or keep', (t) => {
  const { owner, read } = fixture(t, { crossSessionInbound: 'accept', attribution: { commit: '' } });
  for (const choice of ['enable', 'disable', 'keep']) {
    const results = byId(owner.apply(choice));
    assert.equal(results['cross-session-inbound'].status, 'owner-value-kept', choice);
    assert.equal(results.attribution.status, 'owner-value-kept', choice);
  }
  assert.equal(read().crossSessionInbound, 'accept');
  assert.deepEqual(read().attribution, { commit: '' });
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
    // Matching or not, an owner value survives enable and disable untouched.
    for (const choice of ['enable', 'disable']) assert.equal(byId(owner.apply(choice)).attribution.status, 'owner-value-kept', `${label} ${choice}`);
    assert.deepEqual(read().attribution, value, label);
  }
});

test('per-setting choices touch only the named settings; a setting left out is kept', (t) => {
  const { owner, read } = fixture(t, { theme: 'dark' });
  const first = byId(owner.apply({ 'switch-models-on-flag': 'enable' }));
  assert.equal(first['switch-models-on-flag'].status, 'set');
  for (const id of ['attribution', 'cross-session-inbound', 'agents-md']) assert.equal(first[id].status, 'kept', id);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false });

  owner.apply({ attribution: 'enable', 'cross-session-inbound': 'enable' });
  const removed = byId(owner.apply({ attribution: 'disable' }));
  assert.equal(removed.attribution.status, 'claude-default');
  assert.equal(removed.attribution.changed, true);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false, crossSessionInbound: 'accept' });
  assert.deepEqual(owner.inspect().map((state) => state.state), [STATES.DEFAULT, STATES.TOOLKIT, STATES.TOOLKIT, STATES.DEFAULT]);

  assert.throws(() => owner.apply({ 'not-a-setting': 'enable' }), /Unknown Claude setting: not-a-setting/);
  assert.throws(() => owner.apply({ attribution: 'maybe' }), /Unsupported Claude settings choice: maybe/);
  assert.throws(() => owner.apply('maybe'), /Unsupported Claude settings choice: maybe/);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false, crossSessionInbound: 'accept' }, 'a refused call writes nothing');
});

test('an owner edit after Toolkit wrote a value is kept on disable', (t) => {
  const { owner, settingsPath, read } = fixture(t, {});
  owner.apply('enable');
  const edited = read();
  edited.crossSessionInbound = 'hold';
  fs.writeFileSync(settingsPath, `${JSON.stringify(edited, null, 2)}\n`);
  const results = byId(owner.apply('disable'));
  assert.equal(results['cross-session-inbound'].status, 'owner-value-kept');
  assert.equal(read().crossSessionInbound, 'hold');
  assert.equal(Object.hasOwn(read(), 'attribution'), false);
});

test('a file Toolkit created is removed again when nothing else is left', (t) => {
  const { owner, settingsPath } = fixture(t);
  owner.apply('enable');
  assert.ok(fs.existsSync(settingsPath));
  owner.apply('disable');
  assert.equal(fs.existsSync(settingsPath), false);
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
