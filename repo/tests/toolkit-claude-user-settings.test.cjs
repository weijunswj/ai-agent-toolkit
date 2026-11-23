'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ClaudeUserSettings, SETTINGS, STATES, claudeCodeVersion } = require('../scripts/toolkit-claude-user-settings.cjs');

// claudeVersion is pinned (2.1.330 unless a test says otherwise) so each test reads the same AGENTS.md id on every computer.
function fixture(t, initial, claudeVersion = '2.1.330') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-claude-user-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  if (initial !== undefined) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(settingsPath, typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`);
  }
  const ownerFor = (version) => new ClaudeUserSettings({ environment: { CLAUDE_CONFIG_DIR: configDir }, controlRoot: path.join(root, 'control'), claudeVersion: version });
  const owner = ownerFor(claudeVersion);
  const read = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
  return { owner, ownerFor, settingsPath, read, recordPath: path.join(root, 'control', 'claude-user-settings.json') };
}
const NEW_ID = 'cc-plugin-agents-md@builtin';
const OLD_ID = 'agents-md@builtin';
const agentsMdOf = (settings, id) => settings.pluginConfigs?.[id]?.options?.instructionFiles;
const byId = (results) => Object.fromEntries(results.map((result) => [result.id, result]));
// The three settings whose Turn off removes the line; the model-switch setting writes false instead.
const REMOVABLE = ['attribution', 'cross-session-inbound', 'agents-md'];
const removable = (choice) => Object.fromEntries(REMOVABLE.map((id) => [id, choice]));
// The settings an off the owner chose is recorded for, so a later setup keeps them off.
const ownerOffCount = (recordPath) => Object.values(JSON.parse(fs.readFileSync(recordPath, 'utf8')).entries).filter((entry) => entry.owner_off === true).length;

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
  assert.ok(off.filter((result) => REMOVABLE.includes(result.id)).every((result) => result.status === 'owner-off'));
  assert.deepEqual(read(), { permissions: { defaultMode: 'auto' }, pluginConfigs: { other: { options: { a: 1 } } } });
  assert.equal(ownerOffCount(recordPath), 3, 'the record now holds only the three offs the owner chose');
  assert.deepEqual(owner.inspect().map((state) => state.state), [STATES.OWNER_OFF, STATES.OWNER_OFF, STATES.DEFAULT, STATES.OWNER_OFF]);
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
  assert.equal(equal['cross-session-inbound'].status, 'owner-off');
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
  assert.equal(removed.attribution.status, 'owner-off');
  assert.equal(removed.attribution.changed, true);
  assert.deepEqual(read(), { theme: 'dark', switchModelsOnFlag: false, crossSessionInbound: 'accept' });
  assert.deepEqual(owner.inspect().map((state) => state.state), [STATES.OWNER_OFF, STATES.TOOLKIT, STATES.OFF, STATES.DEFAULT]);

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
  assert.equal(ownerOffCount(recordPath), 3, 'only the offs the owner chose stay recorded');
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

test('the AGENTS.md entry goes under the id the running Claude Code reads: the new id from 2.1.285, the old id from 2.1.277 to 2.1.284 and when the version is unknown', (t) => {
  for (const [version, id] of [['2.1.330', NEW_ID], ['2.1.285', NEW_ID], ['2.1.284', OLD_ID], ['2.1.277', OLD_ID], ['', OLD_ID]]) {
    const { owner, read } = fixture(t, {}, version);
    assert.equal(byId(owner.apply({ 'agents-md': 'enable' }))['agents-md'].status, 'set', version || 'unknown');
    assert.equal(agentsMdOf(read(), id), 'claude-md-and-agents-md', version || 'unknown');
    assert.equal(agentsMdOf(read(), id === NEW_ID ? OLD_ID : NEW_ID), undefined, `${version || 'unknown'}: no competing entry`);
  }
  const older = fixture(t, {}, '2.1.276');
  const [held] = older.owner.apply({ 'agents-md': 'enable' }).filter((entry) => entry.id === 'agents-md');
  assert.equal(held.status, 'held');
  assert.deepEqual(older.read(), {}, 'no AGENTS.md setting before 2.1.277, so nothing is written');
});

test('an AGENTS.md entry under the other id is your value: a yes keeps it and writes nothing', (t) => {
  const { owner, settingsPath } = fixture(t, { pluginConfigs: { [OLD_ID]: { options: { instructionFiles: 'claude-md-and-agents-md' } } } }, '2.1.330');
  const state = byId(owner.inspect())['agents-md'];
  assert.deepEqual([state.state, state.matches], [STATES.OWNER, true]);
  const before = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(byId(owner.apply({ 'agents-md': 'enable' }))['agents-md'].changed, false);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'no competing entry under the new id');

  const different = fixture(t, { pluginConfigs: { [OLD_ID]: { options: { instructionFiles: 'claude-md' } } } }, '2.1.330');
  const kept = byId(different.owner.apply({ 'agents-md': 'enable' }))['agents-md'];
  assert.deepEqual([kept.status, kept.changed, kept.state], ['kept', false, STATES.OWNER]);
  assert.deepEqual(different.read(), { pluginConfigs: { [OLD_ID]: { options: { instructionFiles: 'claude-md' } } } });
});

test('an AGENTS.md entry Toolkit wrote under the other id is Toolkit\'s value, and off removes it and the file Toolkit created', (t) => {
  const { ownerFor, settingsPath } = fixture(t, undefined, '2.1.280');
  ownerFor('2.1.280').apply({ 'agents-md': 'enable' });
  const later = ownerFor('2.1.330');
  assert.equal(byId(later.inspect())['agents-md'].state, STATES.TOOLKIT);
  assert.equal(byId(later.apply({ 'agents-md': 'enable' }))['agents-md'].changed, false);
  later.apply({ 'agents-md': 'disable' });
  assert.equal(fs.existsSync(settingsPath), false);
});

test('off removes an AGENTS.md entry under either id, so the setting is off wherever Claude Code reads it', (t) => {
  const both = { [NEW_ID]: { options: { instructionFiles: 'claude-md-and-agents-md' } }, [OLD_ID]: { options: { instructionFiles: 'claude-md-and-agents-md' } } };
  const { owner, read } = fixture(t, { pluginConfigs: both }, '2.1.330');
  assert.equal(byId(owner.apply({ 'agents-md': 'disable' }))['agents-md'].changed, true);
  assert.deepEqual(read(), { pluginConfigs: { [NEW_ID]: { options: {} }, [OLD_ID]: { options: {} } } });
  assert.equal(byId(owner.inspect())['agents-md'].state, STATES.OWNER_OFF);
});

test('the Claude Code version comes only from a folder right after claude-code, or after versions inside claude', () => {
  const at = (execPath) => claudeCodeVersion({ CLAUDE_CODE_EXECPATH: execPath });
  assert.equal(at('C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1.330\\build\\claude.exe'), '2.1.330');
  assert.equal(at('/home/me/.local/share/claude/versions/2.1.330'), '2.1.330');
  assert.equal(at('C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1.330\\bin\\1.0.0\\claude.exe'), '2.1.330', 'a deeper folder named like a version is not read');
  assert.equal(at('C:\\Users\\me\\Downloads\\3.0.1\\claude.exe'), '', 'a version-like folder with no Claude Code folder before it is not read');
  assert.equal(claudeCodeVersion({}), '');
});
