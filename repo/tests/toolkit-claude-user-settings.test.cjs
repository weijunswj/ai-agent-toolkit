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

test('the four recommended settings have their exact documented shapes', () => {
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
