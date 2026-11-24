'use strict';

// Controller settings and the owner-line lint (#1242 S4): the stack profile, live lanes and gate
// placement are settings the project lines and the GATE ROUTE line are rendered from; the owner's
// own lines that repeat or contradict them get one-tap fixes, and every other line is left alone.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const hostile = require('./support/hostile-inputs.cjs');

const ROOT = path.join(__dirname, '..', '..');
const settingsModule = require('../scripts/toolkit-controller-settings.cjs');
const lintModule = require('../scripts/toolkit-owner-lines.cjs');
const PROFILES = Object.keys(require('../contracts/controller-kernel/stack-registry-v3.json').profiles);
const NOW = () => new Date('2026-11-25T08:00:00.000Z');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-controller-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(main, argv, { environment = {}, now = NOW } = {}) {
  let out = '', err = '';
  const code = main(argv, { stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } }, environment, now, root: ROOT });
  return { code, out, err };
}
const set = (file, flags, options) => cli(settingsModule.main, ['set', '--file', file, ...flags], options);
const lint = (argv, options) => cli(lintModule.main, argv, options);
function settingsFile(t, flags = ['--live-lanes', '1']) {
  const file = path.join(scratch(t), 'settings.json');
  const made = set(file, ['--repository', 'example-owner/example-repo', '--stack-profile', 'owner-claude', '--placement', 'remote_control,G2=cloud', '--folder', 'C:\\work\\example-repo', ...flags, '--owner-said', 'one lane, G2 in the cloud']);
  assert.equal(made.code, 0, made.err);
  return file;
}

test('row 1: changing live lanes from 1 to 2 changes the rendered project lines and the GATE ROUTE line', t => {
  const file = settingsFile(t);
  const before = cli(settingsModule.main, ['render', '--file', file, '--json']);
  assert.equal(before.code, 0, before.err);
  const one = JSON.parse(before.out);
  assert.equal(one.gate_route, 'GATE ROUTE: profile owner-claude lanes 1 placement remote_control G2=cloud folder C:\\work\\example-repo');
  assert.equal(one.project_lines[0], '- Lanes: 1 working lane (owner, 2026-11-25)');
  const changed = set(file, ['--live-lanes', '2', '--owner-said', 'lanes 2'], { now: () => new Date('2026-11-26T09:00:00.000Z') });
  assert.equal(changed.code, 0, changed.err);
  assert.match(changed.out, /^Changed and read back: live_lanes\.$/m);
  assert.match(changed.out, /Save it to the evidence store at evidence\/controller\/example-owner\/example-repo\/settings\.json with toolkit-store\.cjs save/);
  const two = JSON.parse(cli(settingsModule.main, ['render', '--file', file, '--json']).out);
  assert.equal(two.gate_route, 'GATE ROUTE: profile owner-claude lanes 2 placement remote_control G2=cloud folder C:\\work\\example-repo');
  assert.equal(two.project_lines[0], '- Lanes: 2 working lanes (owner, 2026-11-26)');
  assert.deepEqual(two.project_lines.slice(1), one.project_lines.slice(1), 'only the lanes line moves');
  // The owner's words are kept with the change; the same value again changes nothing.
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(stored.changes.at(-1), { at: '2026-11-26T09:00:00.000Z', keys: ['live_lanes'], owner_said: 'lanes 2' });
  assert.match(set(file, ['--live-lanes', '2', '--owner-said', 'lanes 2']).out, /^Nothing changed: the settings already say that\.$/m);
  // The Projects block renders with the settings' lines after it.
  const rendered = spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-projects-instructions.cjs'), '--render', '--settings', file], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(rendered.stdout.endsWith(`-->\n\n${two.project_lines.join('\n')}\n`), rendered.stdout.slice(-400));
});

test('only the controller changes settings, on the owner\'s word: a gate session is refused, and so is a change with no words', t => {
  const file = settingsFile(t);
  const text = fs.readFileSync(file, 'utf8');
  for (const role of ['G0', 'G1', 'G2']) {
    const refused = set(file, ['--live-lanes', '3', '--owner-said', 'lanes 3'], { environment: { TOOLKIT_GATE_ROLE: role } });
    assert.equal(refused.code, 1, role);
    assert.match(refused.err, new RegExp(`A ${role} session cannot change controller settings`));
  }
  assert.match(set(file, ['--live-lanes', '3']).err, /Pass the owner's own words with --owner-said/);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'nothing was written');
  for (const bad of [['--live-lanes', '0'], ['--live-lanes', '10'], ['--placement', 'laptop'], ['--placement', 'cloud,G3=cloud'], ['--repository', 'not a repo']]) {
    assert.equal(set(file, [...bad, '--owner-said', 'x']).code, 2, bad.join(' '));
  }
  assert.equal(set(file, ['--stack-profile', 'no-such-profile', '--owner-said', 'x']).code, 1, 'a profile the registry does not have');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('the settings reader is default-deny: unknown keys, types and characters make the file unreadable', t => {
  const good = JSON.parse(fs.readFileSync(settingsFile(t), 'utf8'));
  const read = value => { try { settingsModule.readSettings(JSON.stringify(value), PROFILES); return true; } catch (error) { assert.equal(error.code, 'SETTINGS_INVALID'); return false; } };
  assert.equal(read(good), true);
  for (const [name, change] of [
    ['extra key', value => ({ ...value, lanes: 2 })],
    ['other schema', value => ({ ...value, schema: 'toolkit.controller-settings.v2' })],
    ['lanes as text', value => ({ ...value, live_lanes: '2' })],
    ['lanes zero', value => ({ ...value, live_lanes: 0 })],
    ['unknown place', value => ({ ...value, placement: { default: 'laptop' } })],
    ['unknown gate', value => ({ ...value, placement: { default: 'cloud', gates: { G9: 'cloud' } } })],
    ['placement extra key', value => ({ ...value, placement: { ...value.placement, owner: 'me' } })],
    ['change without words', value => ({ ...value, changes: [{ at: value.changes[0].at, keys: ['live_lanes'] }] })],
  ]) assert.equal(read(change(good)), false, name);
  // Every hostile shape put into a value the renderer prints is refused.
  const text = hostile.shapes.filter(shape => typeof shape.text === 'string' && shape.text.length < 4000);
  hostile.expectDefaultDeny(assert, value => read({ ...good, placement: { ...good.placement, folder: value } }), text, { allow: text.filter(shape => /^[A-Za-z0-9._:\\/~-][A-Za-z0-9 ._:\\/~-]{0,198}[A-Za-z0-9._:\\/~-]$/.test(shape.text)).map(shape => shape.id) });
  hostile.expectDefaultDeny(assert, value => read({ ...good, placement: { ...good.placement, device: value } }), text, { allow: text.filter(shape => /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(shape.text)).map(shape => shape.id) });
  hostile.expectDefaultDeny(assert, value => read({ ...good, changes: [{ ...good.changes[0], owner_said: value }] }), text, { allow: text.filter(shape => /^[\x20-\x7e]{1,500}$/.test(shape.text)).map(shape => shape.id) });
});

// Representative fixtures for the three cases a governed project's instructions showed (a post
// format line against the block's house format, "gates on the laptop" wording, a stack line said
// twice), written for this test; no project's own lines are copied here.
const SQAG_LIKE = [
  '# Project lines',
  '',
  '- Post format: one paragraph per pull request, no headings.',
  '- All gates run on the laptop.',
  '- Stack: owner-claude',
  '- Use the owner-claude stack profile for every gate launch.',
  '- The test repository is example-owner/example-repo.',
  '',
].join('\n');

test('row 2: the three cases are each flagged with one fix, and a reworded duplicate is caught', t => {
  const dir = scratch(t);
  const file = path.join(dir, 'instructions.md');
  fs.writeFileSync(file, SQAG_LIKE);
  const settings = settingsFile(t);
  const checked = lint(['check', '--file', file, '--settings', settings, '--json']);
  assert.equal(checked.code, 1, checked.err);
  const { findings, unknown } = JSON.parse(checked.out);
  const byLine = Object.fromEntries(findings.map(finding => [finding.line, finding]));
  assert.equal(byLine[3].kind, 'overrides-block');
  assert.deepEqual(byLine[3].fix, { action: 'delete' });
  assert.equal(byLine[4].kind, 'conflicts-setting', 'all gates on the laptop, while the settings put G2 in the cloud');
  assert.deepEqual(byLine[4].fix, { action: 'replace', with: '- Gates run on this device by Remote Control; G2 in cloud threads (C:\\work\\example-repo).' });
  assert.equal(byLine[5].kind, 'repeats-setting');
  assert.deepEqual(byLine[5].fix, { action: 'replace', with: '- Stack profile: owner-claude' });
  assert.equal(byLine[6].kind, 'duplicate', 'the stack line said again in other words');
  assert.deepEqual(byLine[6].fix, { action: 'delete' });
  assert.equal(findings.length, 4);
  assert.deepEqual(unknown, [7], 'the plain project fact is left alone');
  // Without settings, a settings line is pointed at the settings and given no fix.
  const bare = JSON.parse(lint(['check', '--file', file, '--json']).out);
  assert.equal(bare.findings.find(finding => finding.line === 5).kind, 'setting');
  assert.equal(bare.findings.find(finding => finding.line === 5).fix, undefined);
  // Lines that repeat Toolkit's Projects block are caught too (its one overlap hint).
  const block = fs.readFileSync(path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md'), 'utf8');
  const copied = block.split('\n').find(line => lintModule.words(line).size >= 6);
  fs.writeFileSync(file, `${copied}\n`);
  assert.equal(JSON.parse(lint(['check', '--file', file, '--block', 'projects', '--json']).out).findings[0].kind, 'repeats-block');
});

test('row 3: a line the reader does not understand is reported as unknown and never fixed', t => {
  const file = path.join(scratch(t), 'CLAUDE.md');
  const lines = ['Always answer in British English.', 'Keep pull requests small.', `Lanes: 2${String.fromCodePoint(0x2028)}working lanes`, `- Stack: owner${String.fromCodePoint(0x2011)}claude`];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const checked = JSON.parse(lint(['check', '--file', file, '--settings', settingsFile(t), '--json']).out);
  assert.deepEqual(checked.findings, []);
  assert.deepEqual(checked.unknown, [1, 2, 3, 4], 'look-alike and hidden-break lines are unknown too');
  const before = fs.readFileSync(file, 'utf8');
  const refused = lint(['apply', '--file', file, '--fix', '1-unknown-00000000']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /not offered for the file as it is now, so nothing was changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // Default-deny over every hostile shape: none is read as a line with a fix.
  const reader = new lintModule.OwnerLineLint({ profiles: PROFILES });
  hostile.expectDefaultDeny(assert, text => { try { return reader.check(text).findings.some(finding => finding.fix); } catch { return false; } }, hostile.shapes.filter(shape => typeof shape.text === 'string'));
});

test('apply changes only the fixes the owner tapped, bound to each line\'s text, keeps CRLF, and reads back', t => {
  const dir = scratch(t);
  const file = path.join(dir, 'instructions.md');
  fs.writeFileSync(file, SQAG_LIKE.split('\n').join('\r\n'));
  const settings = settingsFile(t);
  const { findings } = JSON.parse(lint(['check', '--file', file, '--settings', settings, '--json']).out);
  const stack = findings.find(finding => finding.line === 5);
  const reworded = findings.find(finding => finding.line === 6);
  const applied = lint(['apply', '--file', file, '--settings', settings, '--fix', `${reworded.id},${stack.id}`]);
  assert.equal(applied.code, 0, applied.err);
  assert.match(applied.out, /^Applied and read back: /m);
  const after = fs.readFileSync(file, 'utf8');
  const expected = SQAG_LIKE.split('\n');
  expected.splice(5, 1);
  expected[4] = '- Stack profile: owner-claude';
  assert.equal(after, expected.join('\r\n'), 'the post format and laptop lines the owner did not tap stay');
  // An id from before the change no longer matches anything, so nothing more changes.
  assert.equal(lint(['apply', '--file', file, '--settings', settings, '--fix', reworded.id]).code, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  // A gate session cannot apply a fix.
  const post = JSON.parse(lint(['check', '--file', file, '--settings', settings, '--json']).out).findings.find(finding => finding.kind === 'overrides-block');
  const gate = lint(['apply', '--file', file, '--settings', settings, '--fix', post.id], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(gate.code, 1);
  assert.match(gate.err, /A gate session cannot change the owner's lines/);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  // Toolkit's own block is never read as owner lines.
  const block = fs.readFileSync(path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md'), 'utf8');
  const placed = spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-projects-instructions.cjs'), '--render'], { encoding: 'utf8' }).stdout;
  fs.writeFileSync(file, `${placed}\n- Lanes: 4 working lanes\n`);
  const inBlock = JSON.parse(lint(['check', '--file', file, '--settings', settings, '--json']).out);
  assert.deepEqual(inBlock.findings.map(finding => finding.line), [placed.split('\n').length + 1]);
  assert.ok(block.length > 0);
});
