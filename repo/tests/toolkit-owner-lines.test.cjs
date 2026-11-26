'use strict';

// The owner-line lint (#1242 S4): the owner's own lines that repeat or contradict the controller
// settings get one-tap fixes, only where the whole line is a shape the reader knows and stands on its
// own; every other line is left alone. A fix is bound to what the owner was shown, and applying one
// never changes or loses anything else. The settings themselves are in
// toolkit-controller-settings.test.cjs.

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
const BLOCK = fs.readFileSync(path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects/project-instructions.md'), 'utf8').replace(/\r\n/g, '\n');
const cp = (...points) => String.fromCodePoint(...points);
const realWrite = fs.writeFileSync;
const realRename = fs.renameSync;

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-owner-lines-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function cli(main, argv, environment = {}, now = () => new Date('2026-11-25T08:00:00.000Z')) {
  let out = '', err = '';
  const code = main(argv, { stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } }, environment, now, root: ROOT });
  return { code, out, err };
}
const set = (file, flags) => cli(settingsModule.main, ['set', '--file', file, ...flags, '--owner-said', 'fixture']);
function settingsIn(dir, flags = ['--live-lanes', '2'], repository = 'example-owner/example-repo') {
  const file = path.join(dir, `settings-${repository.replace('/', '-')}.json`);
  const made = set(file, ['--repository', repository, '--stack-profile', 'owner-claude', ...flags]);
  assert.equal(made.code, 0, made.err);
  return file;
}
// A file of owner lines, checked: { file, findings, unknown, code }.
function check(dir, text, extra = []) {
  const file = path.join(dir, 'lines.md');
  fs.writeFileSync(file, text);
  const result = cli(lintModule.main, ['check', '--file', file, ...extra, '--json']);
  assert.ok(result.out, result.err);
  return { file, code: result.code, ...JSON.parse(result.out) };
}
const apply = (file, ids, extra = [], environment) => cli(lintModule.main, ['apply', '--file', file, '--fix', ids, ...extra], environment);
const fixes = result => result.findings.filter(finding => finding.fix);
// Runs fn with fs functions replaced, then puts them back.
function withFs(replacements, fn) {
  const real = Object.fromEntries(Object.keys(replacements).map(name => [name, fs[name]]));
  Object.assign(fs, replacements);
  try { return fn(); } finally { Object.assign(fs, real); }
}
// A reader with settings in memory, for the tables: { placement, lanes } as the settings file has them.
function reader({ placement = { default: 'remote_control' }, lanes = 2, block = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-owner-lines-'));
  try {
    const gates = Object.entries(placement.gates || {}).map(([gate, place]) => `,${gate}=${place}`).join('');
    const file = settingsIn(dir, ['--live-lanes', String(lanes), '--placement', `${placement.default}${gates}`, ...(placement.device ? ['--device', placement.device] : []), ...(placement.folder ? ['--folder', placement.folder] : [])]);
    const rendered = new settingsModule.ControllerSettings({ file, profiles: PROFILES }).render();
    return new lintModule.OwnerLineLint({ profiles: PROFILES, settings: rendered.settings, rendered, blockBody: block ? BLOCK : null, environment: {} });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Representative fixtures for the three cases a governed project's instructions showed (a post
// format line against the block's house format, "gates on the laptop" wording, a stack line said
// twice), written for this test; no project's own lines are copied here.
const THREE_CASES = [
  '# Project lines',
  '',
  '- Post format: one paragraph per pull request, no headings.',
  '- All gates run on the laptop.',
  '- Stack: owner-claude',
  '- Use the owner-claude stack profile for every gate launch.',
  '- The test repository is example-owner/example-repo.',
  '',
].join('\n');
const SPLIT = ['--live-lanes', '1', '--placement', 'remote_control,G2=cloud', '--folder', 'C:\\work\\example-repo'];

test('row 2: the three cases are each flagged with one fix, and a reworded duplicate is caught', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir, SPLIT), '--block', 'projects'];
  const result = check(dir, THREE_CASES, extra);
  assert.equal(result.code, 1);
  const byLine = Object.fromEntries(result.findings.map(finding => [finding.line, finding]));
  assert.equal(byLine[3].kind, 'overrides-block');
  assert.deepEqual(byLine[3].fix, { action: 'delete' });
  assert.equal(byLine[4].kind, 'conflicts-setting', 'all gates on the laptop, while the settings put G2 in the cloud');
  assert.match(byLine[4].message, /It says placement remote_control, but the controller settings say remote_control G2=cloud/);
  assert.deepEqual(byLine[4].fix, { action: 'replace', with: '- Gates run on this device by Remote Control; G2 in cloud threads (C:\\work\\example-repo).' });
  assert.equal(byLine[5].kind, 'repeats-setting');
  assert.deepEqual(byLine[5].fix, { action: 'replace', with: '- Stack profile: owner-claude' });
  assert.equal(byLine[6].kind, 'duplicate', 'the stack line said again in other words');
  assert.deepEqual(byLine[6].fix, { action: 'delete' });
  assert.equal(result.findings.length, 4);
  assert.deepEqual(result.unknown, [7], 'the plain project fact is left alone');
  // The plain report prints the line beside each fix, so the owner sees what would go.
  const plain = cli(lintModule.main, ['check', '--file', result.file, ...extra]).out;
  for (const finding of fixes(result)) assert.ok(plain.includes(`line ${finding.line}: "${finding.text}" `) && plain.includes(`Fix ${finding.id}: `), plain);
  assert.match(plain, /^Read against the controller settings of example-owner\/example-repo\.$/m);
  // Without the block there is no house format to set against, so a post format line is the owner's own.
  const noBlock = check(dir, THREE_CASES, extra.slice(0, 2));
  assert.deepEqual(noBlock.unknown, [3, 7]);
  // Without settings, a settings line is pointed at the settings and given no fix, and needs attention.
  const bare = check(dir, '- Stack: owner-claude\n');
  assert.deepEqual([bare.code, bare.findings[0].kind, bare.findings[0].fix], [1, 'setting', undefined]);
  // A line of Toolkit's block copied whole is a repeat of it.
  const copied = BLOCK.split('\n').find(line => lintModule.words(line).size >= 6);
  const repeat = check(dir, `${copied}\n`, ['--block', 'projects']);
  assert.deepEqual([repeat.findings[0].kind, repeat.findings[0].fix], ['repeats-block', { action: 'delete' }]);
});

test('row 3: a line the reader does not understand is reported as unknown and never fixed', t => {
  const dir = scratch(t);
  const lines = ['Always answer in British English.', 'Keep pull requests small.', `Lanes: 2${cp(0x2028)}working lanes`, `- Stack: owner${cp(0x2011)}claude`];
  const result = check(dir, `${lines.join('\n')}\n`, ['--settings', settingsIn(dir)]);
  assert.deepEqual([result.code, result.findings], [0, []]);
  assert.deepEqual(result.unknown, [1, 2, 3, 4], 'look-alike and hidden-break lines are unknown too');
  const before = fs.readFileSync(result.file, 'utf8');
  const refused = apply(result.file, '1-unknown-00000000');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /not offered for the file and settings as they are now, so nothing was changed/);
  assert.equal(fs.readFileSync(result.file, 'utf8'), before);
});

// ---- H1: the reader is default-deny -----------------------------------------------------------

// Every shape the reader knows, with what it reads: the positive controls.
const READ = [
  ['Lanes: 5', 'live lanes 5'], ['Lane: 1', 'live lanes 1'], ['Live lanes: three', 'live lanes 3'], ['Lanes: 5 working lanes (owner, 2026-11-01)', 'live lanes 5'], ['4 working lanes.', 'live lanes 4'],
  ['Stack: owner-gpt', 'stack profile owner-gpt'], ['Stack profile: `owner-gpt`', 'stack profile owner-gpt'], ['The stack profile is owner-gpt.', 'stack profile owner-gpt'], ['Use the owner-gpt profile for all gates.', 'stack profile owner-gpt'], ['Use the owner-gpt stack profile for every gate launch.', 'stack profile owner-gpt'],
  ['Gates run in cloud threads', 'placement cloud'], ['All gates run in the cloud.', 'placement cloud'], ['Gates run wherever the controller starts them.', 'placement any'], ['Gate work runs on my computer; G2 in cloud threads (owner, 2026-11-01).', 'placement remote_control G2=cloud'], ['Gates run on this device by Remote Control (D:\\other).', 'placement remote_control'],
];
// Lines that hold the same words and say something else: the negative controls.
const NOT_READ = [
  'Gates never run in the cloud.', 'Gates must not run in cloud threads.', 'Gates do not run in the cloud.', 'No gates run in the cloud.', 'Gates run in the order G0, G1, G2.', 'Gates run in the cloud only on Fridays.', 'Gates run on the server.', 'Gates run in the cloud, except G2.',
  'Gates run in cloud threads (never).', 'Gates run in cloud threads (unless I say otherwise).', 'Gates run in cloud threads; G2 nowhere.', 'Gates run in cloud threads; G2 by Remote Control; G2 in the cloud.', 'Gates ran in cloud threads.', 'Gates run on this device or in cloud threads.',
  'Do not change the owner-claude profile without asking me.', 'Stack: Next.js, Postgres and Stripe; gate routes use owner-claude.', 'Reviews for the billing repository use the owner-gpt profile.', 'Never use the owner-gpt profile for every gate launch.', 'Use the owner-gpt profile for G2 only.', 'Stack: not owner-gpt', 'Stack: no-such-profile', 'Stack: ~~owner-gpt~~',
  'Board: https://example.com/boards/1', 'Updates: run npm outdated on Mondays, grouped in one PR.', 'Posts: ask me first.', 'Post format: never post secrets', 'Post format: two lines, and ask me first',
  'Never open more than one lane on the release branch.', 'The bowling site has 8 lanes to book.', 'Lanes: at most 5', 'Lanes: 5 (but ask me first)', 'Lanes: 10', 'Lanes: 0', 'Lanes: 2 or 3', '"Lanes: 5"', '`Lanes: 5`', '[ ] Lanes: 5', 'Lanes: 5 <!-- old -->', 'Lanes: 5 5',
];

test('H1: the whole line is the shape, or it is unknown: positive and negative controls', () => {
  const lint = reader({ placement: { default: 'cloud', gates: { G1: 'remote_control' } }, lanes: 9 });
  for (const [body, says] of READ) {
    for (const line of [`- ${body}`, body, `* ${body}`, `1. ${body}`, `-  ${body.replace(' ', '  ')}`]) {
      const { findings, unknown } = lint.check(`${line}\n`);
      assert.deepEqual([findings.length, findings[0]?.kind, findings[0]?.fix?.action, unknown], [1, 'conflicts-setting', 'replace', []], line);
      assert.ok(findings[0].message.startsWith(`It says ${says}`), `${line}: ${findings[0].message}`);
    }
    // One more word, and any negation, at either end: unknown.
    for (const line of [...['Never', 'Do not say:', 'Once', 'Retired:', 'If asked,'].map(word => `- ${word} ${body}`), ...['cancelled', 'no longer', 'should CI pass', '- not any more', 'except on Fridays', '(not yet)', 'and G3 too', '?'].map(word => `- ${body} ${word}`), `- ${body}${body}`]) {
      const result = lint.check(`${line}\n`);
      assert.deepEqual([result.findings, result.unknown], [[], [1]], line);
    }
  }
  for (const settings of [{ default: 'cloud' }, { default: 'remote_control' }, { default: 'any' }]) {
    const other = reader({ placement: settings });
    const against = reader({ placement: settings, block: true });
    for (const line of NOT_READ) {
      assert.deepEqual([other.check(`- ${line}\n`).findings, other.check(`- ${line}\n`).unknown], [[], [1]], `${settings.default}: ${line}`);
      assert.deepEqual(against.check(`- ${line}\n`).findings.filter(finding => finding.fix || finding.kind !== 'repeats-block'), [], `${settings.default}, block: ${line}`);
    }
  }
});

test('H1: a line that says what the settings say is a repeat only when it says all of it', () => {
  const split = reader({ placement: { default: 'remote_control', gates: { G2: 'cloud' }, device: 'desk', folder: 'C:\\work' } });
  const kind = line => split.check(`${line}\n`).findings[0]?.kind;
  assert.equal(kind('- Gates run on this device by Remote Control; G2 in cloud threads (desk, C:\\work).'), undefined, 'the rendered line itself');
  // The settings name the device desk, so a laptop may be another computer (M-A): asked, not fixed.
  assert.equal(kind('- Gates run on this device; G2 in the cloud.'), 'repeats-setting');
  assert.equal(kind('- Gates run on my computer; G1 on my computer; G2 in the cloud.'), 'repeats-setting', 'a gate at the default adds nothing');
  assert.equal(kind('- Gates run on my laptop; G2 in the cloud.'), 'conflicts-setting');
  assert.equal(split.check('- Gates run on my laptop; G2 in the cloud.\n').findings[0].fix, undefined);
  for (const line of ['- Gates run on my laptop.', '- All gates run on my laptop.', '- Gates run on my laptop; G2 in the cloud (C:\\old).', '- Gates run on my laptop; G2 in the cloud (desk, C:\\old).', '- Gates run on my laptop; G1 in the cloud.']) assert.equal(kind(line), 'conflicts-setting', line);
  assert.equal(kind('- Gates run on my laptop; G2 in the cloud (other-desk, C:\\old).'), undefined, 'another device name is a word the reader does not know');
});

test('H1: a second line with another value is a conflict naming both, and an equal one a duplicate', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  const two = check(dir, '- Lanes: 2 working lanes (owner, 2026-11-25)\n- Lanes: 5 working lanes (owner, 2026-11-01)\n', extra);
  assert.deepEqual([two.code, two.findings.length, two.findings[0].kind, two.findings[0].fix], [1, 1, 'conflicts-line', undefined]);
  assert.match(two.findings[0].message, /^It says live lanes 5, but line 1 says 2, and the controller settings say 2\./);
  const without = check(dir, '- Stack: owner-claude\n- Stack: owner-gpt\n');
  assert.deepEqual([without.code, without.findings[1].kind, without.findings[1].fix], [1, 'conflicts-line', undefined]);
  assert.match(without.findings[1].message, /^It says stack profile owner-gpt, but line 1 says owner-claude\./);
  const folders = check(dir, '- Gates run on my laptop (C:\\a).\n- Gates run on my laptop (C:\\b).\n');
  assert.match(folders.findings[1].message, /^It says placement remote_control with C:\\b, but line 1 names C:\\a\./);
  // The stale line first: it is the one fixed, and the settings' own line after it stays.
  const stale = check(dir, '- Lanes: 5\n- Lanes: 2 working lanes (owner, 2026-11-25)\n', extra);
  assert.deepEqual(stale.findings.map(finding => [finding.line, finding.kind]), [[1, 'conflicts-setting']]);
  const equal = check(dir, '- Lanes: 2 working lanes (owner, 2026-11-25)\n- 2 working lanes\n', extra);
  assert.deepEqual(equal.findings.map(finding => [finding.line, finding.kind, finding.fix.action]), [[2, 'duplicate', 'delete']]);
});

// From the G2 round 2 of PR 1522 (M-A): "this device", "my computer" or "by Remote Control" is the
// device the controller works from, but a laptop, a desktop and a PC are kinds of computer that may be
// different ones. A line naming one is the same as another line only when both name the same kind, and
// the same as the settings only when the settings name no device; anything else is asked, never fixed.
test('M-A: two lines naming two kinds of computer are a conflict with no fix, never a duplicate', t => {
  const dir = scratch(t);
  for (const [first, second] of [['laptop', 'desktop'], ['desktop', 'pc'], ['desktop', 'laptop'], ['laptop', 'computer']]) {
    const found = check(dir, `- Gates run on my ${first}.\n- Gates run on my ${second}.\n`);
    const onLine2 = found.findings.filter(finding => finding.line === 2);
    assert.deepEqual(onLine2.map(finding => [finding.kind, finding.fix]), [['conflicts-line', undefined]], `${first} then ${second}`);
    assert.match(onLine2[0].message, new RegExp(`^It says placement remote_control on my ${second}, but line 1 says on my ${first}: they may be two computers\\. Ask the owner which one stands; no fix is offered\\.$`));
    assert.equal(found.code, 1, 'a conflict needs the owner');
  }
  // The same kind said twice, or the device said two ways, is still one line too many.
  for (const [first, second] of [['laptop', 'laptop'], ['computer', 'device'], ['machine', 'computer']]) {
    const found = check(dir, `- Gates run on my ${first}.\n- Gates run on the ${second}.\n`);
    assert.deepEqual(found.findings.filter(finding => finding.line === 2).map(finding => [finding.kind, finding.fix]), [['duplicate', { action: 'delete' }]], `${first} then ${second}`);
  }
});

test('M-A: a line naming a kind of computer is never what the settings say when they name a device', t => {
  const dir = scratch(t);
  const withDevice = ['--settings', settingsIn(dir, ['--live-lanes', '2', '--placement', 'remote_control', '--device', 'laptop-1'])];
  const found = check(dir, '- Gates run on the desktop.\n', withDevice);
  assert.deepEqual(found.findings.map(finding => [finding.kind, finding.fix]), [['conflicts-setting', undefined]]);
  assert.equal(found.findings[0].message, 'It says placement remote_control on the desktop, but the controller settings name the device laptop-1: it may be another computer. Ask the owner which one stands, or change the settings on the owner\'s word; no fix is offered.');
  assert.equal(found.code, 1, 'a conflict with no fix still needs the owner');
  // The device itself, named in the brackets, is the same computer; "this device" is too.
  assert.deepEqual(check(dir, '- Gates run on my laptop (laptop-1).\n', withDevice).findings.map(finding => finding.kind), ['repeats-setting']);
  assert.deepEqual(check(dir, '- Gates run on this device.\n', withDevice).findings.map(finding => finding.kind), ['repeats-setting']);
  // With no device in the settings, a named kind keeps its one fix (the settings line replaces it).
  const noDevice = ['--settings', settingsIn(dir, ['--live-lanes', '2', '--placement', 'remote_control'], 'example-owner/other-repo')];
  const kept = check(dir, '- Gates run on my laptop.\n', noDevice);
  assert.deepEqual(kept.findings.map(finding => [finding.kind, finding.fix?.action]), [['repeats-setting', 'replace']]);
});

// M-B: a block line under a heading that may turn its meaning round keeps the heading hold, as a
// settings line does; under a heading that keeps its meaning, the same line still gets its fix.
test('M-B: a block line under a heading that may change what it means is not offered for removal', t => {
  const dir = scratch(t);
  const line = BLOCK.split('\n').find(entry => /^- /.test(entry) && entry.length > 60);
  for (const heading of ['## Toolkit lines I do not want here', '## Not in this project', '## Billing repository']) {
    const found = check(dir, `${heading}\n\n${line}\n`, ['--block', 'projects']);
    assert.deepEqual(found.findings.map(finding => [finding.kind, finding.fix]), [['repeats-block', undefined]], heading);
    assert.match(found.findings[0].message, new RegExp(`^It is the same as line \\d+ of Toolkit's block, but its heading "${heading.slice(3)}" may change what it means, so no fix is offered: read both\\.$`));
  }
  const plain = check(dir, `## Project lines\n\n${line}\n`, ['--block', 'projects']);
  assert.deepEqual(plain.findings.map(finding => [finding.kind, finding.fix]), [['repeats-block', { action: 'delete' }]]);
});

// A line gets a fix only where it stands on its own. Each entry: text with one settings line in it
// (or one repeated line), and whether its fix is offered.
const PLACES = [
  ['alone', '- Lanes: 5\n', true],
  ['between other items', '- Keep it small.\n- Lanes: 5\n- Ask me first.\n', true],
  ['after a heading for project lines', '# Riverside project\n\n## Controller settings\n\n- Lanes: 5\n', true],
  ['after a sentence line', 'The project is run by one controller.\nLanes: 5.\nEnd.\n', true],
  ['a comment above', '<!-- note -->\n- Lanes: 5\n', true],
  ['after a lead-in that is over', 'Where work runs:\n- on my computer\n\nLanes: 5.\n', true],
  ['nested', '- Do not do any of these:\n  - Lanes: 5\n', false],
  ['indented by a tab', '-\tOld:\n\t- Lanes: 5\n', false],
  ['under a lead-in line', 'Never do these:\n- Keep notes\n- Lanes: 5\n', false],
  ['under a lead-in line with a blank line', 'Never do these:\n\n- Keep notes\n\n- Lanes: 5\n', false],
  ['under a plain line a list hangs on', 'We dropped the following\n- Lanes: 5\n', false],
  ['under a sentence a list hangs on', 'Do none of the following.\n- Lanes: 5\n', false],
  ['under a bare line that reads like a heading', 'Retired rules\n\n- Lanes: 5\n', false],
  ['in a tag', '<del>\n\n- Lanes: 5\n\n</del>\n', false],
  ['in a fenced note', '::: old\n\n- Lanes: 5\n\n:::\n', false],
  ['after a labelled line', 'Goal: keep it small\n\n- Lanes: 5\n', true],
  ['under a bold line', '**Retired**\n\n- Lanes: 5\n', false],
  ['under an item that introduces the next', '- Not any more:\n- Lanes: 5\n', false],
  ['a wrapped item', '- Lanes: 5\n  only on weekdays\n', false],
  ['a wrapped item with no indent', '- Lanes: 5\nonly on weekdays\n', false],
  ['an item with a later part', '- Lanes: 5\n\n  only on weekdays\n', false],
  ['an item with sub items', '- Lanes: 5\n  - but not on Fridays\n', false],
  ['the end of a wrapped sentence', 'We decided never to say\nLanes: 5\n', false],
  ['the start of a wrapped sentence', 'Lanes: 5\nis what the old project said.\n', false],
  ['a line after an item', '- It used to be\nLanes: 5\n', false],
  ['a line a list hangs on', 'Lanes: 5.\n- but not on Fridays\n', false],
  ['a line after a quote', '> They said\nLanes: 5\n', false],
  ['under a heading about something else', '## Billing repository\n\n- Lanes: 5\n', false],
  ['under a heading inside it', '## Billing repository\n\n### Gates\n\n- Lanes: 5\n', false],
  ['under a retired heading', '## Old rules\n- Lanes: 5\n', false],
  ['under an underlined heading', 'Billing rules.\n-------------\n- Lanes: 5\n', false],
  ['under a title that says no', '# Never do these\n\n- Lanes: 5\n', false],
  ['under a second title', '# Project\n\nText.\n\n# Example\n\n- Lanes: 5\n', false],
  ['in a file with line breaks the reader does not read', `Old${cp(0x2028)}notes.\n\n- Lanes: 5\n`, false],
  ['in a file with a lone carriage return', `Old${cp(0x0d)}notes.\n\n- Lanes: 5\n`, false],
];

test('H1: a settings line gets a fix only where it stands on its own', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  for (const [name, text, offered] of PLACES) {
    for (const form of [text, text.replace(/\n/g, '\r\n')]) {
      const result = check(dir, form, extra);
      const finding = result.findings.find(entry => /Lanes: 5/.test(entry.text));
      assert.equal(Boolean(finding?.fix), offered, `${name}: ${JSON.stringify(result.findings)}`);
      if (!offered) {
        assert.ok(!finding || finding.kind === 'held', name);
        if (finding) assert.match(finding.message, /^It reads like live lanes 5, but .*, so no fix is offered\.$/, name);
      }
    }
  }
  // The same for a post format line, against the block.
  for (const [name, text, offered] of PLACES) {
    const result = check(dir, text.replace('Lanes: 5', 'Post style: two short paragraphs, no emojis'), [...extra, '--block', 'projects']);
    assert.equal(result.findings.some(entry => /Post style/.test(entry.text) && entry.fix), offered, `post format ${name}`);
  }
});

test('H1: fences, quotes, tables, comments, front matter and Toolkit blocks are not owner lines', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir), '--block', 'projects'];
  const placed = spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-projects-instructions.cjs'), '--render'], { encoding: 'utf8' }).stdout;
  for (const [name, text] of [
    ['a fence', '```\n- Lanes: 5\n```\n'],
    ['a tilde fence that holds backticks', '~~~~ md\n```\n- Lanes: 5\n~~~\n- Lanes: 4\n~~~~\n'],
    ['a fence in an item', '- ```\n- Lanes: 5\n  ```\n'],
    ['an unclosed fence', '```\n- Lanes: 5\n\nMore.\n- Lanes: 4\n'],
    ['a quote', '> - Lanes: 5\n- > Lanes: 5\n'],
    ['a table', '| Lanes: 5 | x |\n|---|---|\n'],
    ['a comment of many lines', '<!--\n- Lanes: 5\n-->\n'],
    ['a comment opened after text', 'Notes. <!-- old\n- Lanes: 5\n-->\n'],
    ['front matter', '---\nprofile: owner-gpt\nlanes: 5\n---\n'],
    ['a rule', '---\n'],
    ['Toolkit\'s own block', placed],
  ]) {
    const result = check(dir, text, extra);
    assert.deepEqual(result.findings, [], name);
    assert.ok(result.unknown.every(line => /Notes/.test(text.split('\n')[line - 1])), `${name}: ${result.unknown}`);
  }
  // The line after each of them is read again.
  const after = check(dir, `${placed}\n- Lanes: 4 working lanes\n`, extra);
  assert.deepEqual(after.findings.map(finding => [finding.line, finding.kind]), [[placed.split('\n').length + 1, 'conflicts-setting']]);
  for (const text of ['```\nx\n```\n\n- Lanes: 4\n', '<!-- a\nb -->\n- Lanes: 4\n', '---\nname: x\n---\n\n- Lanes: 4\n']) assert.equal(fixes(check(dir, text, extra)).length, 1, text);
  // A marker that is not closed stops the read: nothing is offered and nothing can be applied.
  const broken = path.join(dir, 'broken.md');
  fs.writeFileSync(broken, `${placed.split('\n').slice(0, 3).join('\n')}\n- Lanes: 4\n`);
  for (const argv of [['check', '--file', broken, ...extra], ['apply', '--file', broken, ...extra, '--fix', '4-conflicts-setting-0']]) {
    const stopped = cli(lintModule.main, argv);
    assert.deepEqual([stopped.code, stopped.out], [1, ''], argv[0]);
    assert.match(stopped.err, /marker that is not closed or is repeated, so its owner lines are not read/);
  }
});

test('H1: a line labelled as kept or as adding to the block is left alone by every rule', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir), '--block', 'projects'];
  const rule = 'Keep the changelog short and plain for readers.';
  const copied = BLOCK.split('\n').find(line => lintModule.words(line).size >= 6);
  for (const label of ['(adds to the block)', '(adds to the block\'s git safety)', '(kept by the owner)', '(kept from an edit inside the block)']) {
    const lines = ['- Lanes: 5', '- Post format: no headings', copied, rule, rule].map((line, index) => (index === 3 ? line : `${line} ${label}`));
    const result = check(dir, `${lines.join('\n\n')}\n`, extra);
    assert.deepEqual(result.findings, [], label);
    assert.equal(result.unknown.length, lines.length, label);
  }
});

test('H1: only the same line again is a duplicate to remove; a near copy is a hint with no fix', t => {
  const dir = scratch(t);
  const rule = 'Merge only after the review passes.';
  const second = (text, extra) => check(dir, text, extra).findings.map(finding => [finding.line, finding.kind, finding.fix?.action]);
  assert.deepEqual(second(`- ${rule}\n- Other.\n- ${rule}\n`), [[3, 'duplicate', 'delete']]);
  assert.deepEqual(second(`${rule}\n${rule}\n`), [[2, 'duplicate', 'delete']]);
  for (const later of [
    'Do not merge only after the review passes.', 'Merge only after the review passes, the owner types merge N, the store is backed up, and never on a Friday.',
    'Merge after the review only passes.', 'Merge only after 2 review passes.', 'Merge only after the review passes?', 'Merge only after the review passes!', 'Merge only after the (second) review passes.',
  ]) assert.deepEqual(second(`- ${rule}\n- ${later}\n`).filter(([, , action]) => action), [], later);
  assert.deepEqual(second('- Ask the owner before merging, never after deploying.\n- Ask the owner after merging, never before deploying.\n'), [[2, 'duplicate-hint', undefined]]);
  assert.deepEqual(second('- Deploy the staging site after each merge without asking me first.\n- Do not deploy the staging site after each merge without asking me first.\n'), [[2, 'duplicate-hint', undefined]]);
  // The same line where its place matters: another part of the file, a list of steps, a nested line.
  for (const text of [`## Repository A\n- ${rule}\n## Repository B\n- ${rule}\n`, `1. ${rule}\n2. Deploy.\n3. ${rule}\n`, `- On Fridays:\n  - ${rule}\n- Other.\n- ${rule}\n`, `- ${rule}\n- On Fridays:\n  - ${rule}\n`, `On Fridays:\n- ${rule}\n\n- ${rule}\n`, `- ${rule}\n- Other.\n\n1. ${rule}\n`, `- ${rule}\n  Only on Fridays.\n- Other.\n- ${rule}\n`]) {
    assert.deepEqual(second(text).filter(([, , action]) => action), [], text);
  }
  // A line the dedupe rule trims (the shared fixtures) is never offered for removal.
  for (const name of ['repo-project-before.md', 'no-repo-project-before.md', 'repo-project-expected.md', 'no-repo-project-expected.md']) {
    const result = check(dir, fs.readFileSync(path.join(ROOT, 'repo/tests/fixtures/projects-dedupe', name), 'utf8'), ['--block', 'projects']);
    assert.deepEqual(fixes(result), [], name);
  }
  assert.ok(check(dir, fs.readFileSync(path.join(ROOT, 'repo/tests/fixtures/projects-dedupe/repo-project-before.md'), 'utf8'), ['--block', 'projects']).findings.some(finding => finding.kind === 'repeats-block'), 'the hint itself stays');
});

test('H1: no line of this repository\'s own instruction files is offered a fix', () => {
  const list = dir => fs.readdirSync(path.join(ROOT, dir)).filter(name => name.endsWith('.md')).map(name => `${dir}/${name}`);
  const files = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'repo/CONTROLLER.md', ...list('repo/controller'), ...list('repo/contracts/agent-rules'), ...list('repo/docs/agent-playbooks'),
    ...list('repo/contracts/claude-projects/web-controller-projects'), ...list('repo/contracts/claude-projects/web-controller-projects/reference')];
  assert.ok(files.length > 30);
  const readers = [reader({ placement: { default: 'cloud' } }), reader({ placement: { default: 'any' }, lanes: 1 }), new lintModule.OwnerLineLint({ profiles: PROFILES, environment: {} }),
    new lintModule.OwnerLineLint({ profiles: PROFILES, blockBody: BLOCK, environment: {} })];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    readers.forEach((lint, index) => {
      // The block's own source is the one text whose lines the block repeats.
      if (index === 3 && rel.endsWith('/project-instructions.md')) return;
      const offered = fixes(lint.check(text));
      assert.deepEqual(offered.map(finding => `${rel}:${finding.line} ${finding.message}`), []);
    });
  }
});

test('H1: hostile inputs that hold settings lines are never read as a line with a fix', () => {
  const lint = reader({ block: true, lanes: 9, placement: { default: 'any' } });
  const offers = text => { try { return lint.check(text).findings.some(finding => finding.fix); } catch { return false; } };
  const settingsLines = ['- Lanes: 5 working lanes', '- Stack: owner-gpt', '- Gates run in cloud threads', '- Post format: one paragraph per post'];
  for (const line of settingsLines) assert.ok(offers(`${line}\n`), `control: ${line}`);
  // Every unusual character the shared cases know, put at every place in the line.
  const points = [...new Set(hostile.shapes.flatMap(shape => shape.points))].filter(point => point !== 0x0d);
  assert.ok(points.length > 10);
  const placed = settingsLines.flatMap(line => points.flatMap(point => Array.from({ length: line.length + 1 }, (_, at) => ({ id: `${line} ${point.toString(16)} at ${at}`, text: `${line.slice(0, at)}${cp(point)}${line.slice(at)}\n` }))))
    // A byte order mark at the very start of a file is an encoding mark, not text.
    .filter(entry => entry.text.codePointAt(0) !== 0xfeff);
  hostile.expectDefaultDeny(assert, offers, placed);
  // Each shared case beside, around and inside a settings line: hidden text, quotes, escapes, refusals.
  const shapes = hostile.shapes.filter(shape => typeof shape.text === 'string' && shape.text.length < 4000 && shape.text.trim() !== '');
  for (const line of settingsLines) {
    hostile.expectDefaultDeny(assert, value => offers(`${line} ${value}\n`), shapes.filter(shape => !/^[\r\n]/.test(shape.text) && shape.text.replace(/\ufeff/g, '').trim() !== ''), { allow: [] });
    hostile.expectDefaultDeny(assert, value => offers(`- ${value} ${line.slice(2)}\n`), shapes.filter(shape => !/\n/.test(shape.text) && shape.text.replace(/\ufeff/g, '').trim() !== ''));
  }
  // The other line-break forms of a whole file: only CRLF, a leading mark and the tab form (no indents here) are the same file.
  hostile.expectDefaultDeny(assert, value => offers(value), hostile.variants(`${settingsLines.join('\n')}\n`), { allow: ['crlf', 'bom', 'tabs'] });
  // Large inputs are read in linear time.
  for (const shape of hostile.cases(['large-input'])) {
    const measured = hostile.timing(text => lint.check(text), shape.build, { maxSize: 1 << 18 });
    assert.ok(measured.ok, `${shape.id}: ${measured.message}`);
  }
});

// ---- M1: who may apply ------------------------------------------------------------------------

test('M1: a gate session, by its launcher mark or its brief, and a launcher-bound helper cannot apply a fix', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  const { file, findings } = check(dir, '- Lanes: 5\n', extra);
  const host = path.join(dir, 'host', 'projects', 'p');
  fs.mkdirSync(host, { recursive: true });
  fs.writeFileSync(path.join(host, 'session-1.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Gate: G2\nRoute: owner-claude REVIEWER opus-5.5/xhigh\n\nReview it.' } })}\n`);
  for (const [environment, said] of [
    [{ TOOLKIT_GATE_ROLE: 'G1' }, /^A G1 session cannot change the owner's lines/],
    [{ TOOLKIT_NATIVE_HELPER_BINDING: 'helper.json' }, /as a helper cannot change the owner's lines/],
    [{ CLAUDE_CODE_SESSION_ID: 'session-1', CLAUDE_CONFIG_DIR: path.join(dir, 'host') }, /^A G2 session cannot change the owner's lines/],
  ]) {
    const refused = apply(file, findings[0].id, extra, environment);
    assert.equal(refused.code, 1);
    assert.match(refused.err, said);
    assert.equal(cli(lintModule.main, ['check', '--file', file, ...extra], environment).code, 1, 'reading stays open');
  }
  assert.equal(fs.readFileSync(file, 'utf8'), '- Lanes: 5\n');
  assert.equal(apply(file, findings[0].id, extra).code, 0);
});

// ---- M2: the fix applied is the fix that was shown ---------------------------------------------

test('M2: a fix is bound to its replacement, its line, the whole file and the settings\' repository', t => {
  const dir = scratch(t);
  const settings = settingsIn(dir);
  const extra = ['--settings', settings, '--repository', 'example-owner/example-repo'];
  const text = '- Lanes: 5 working lanes\n\nKeep the changelog short and plain for readers.\nKeep the changelog short and plain for readers.\nKeep the changelog short and plain for readers.\n';
  const { file, findings } = check(dir, text, extra);
  const [lanes, second, third] = findings;
  assert.deepEqual(findings.map(finding => finding.line), [1, 4, 5]);
  assert.equal(new Set(findings.map(finding => finding.id)).size, 3);
  const unchanged = (result, name) => {
    assert.equal(result.code, 1, name);
    assert.match(result.err, /not offered for the file and settings as they are now, so nothing was changed/, name);
  };
  // The settings moved on: the replacement shown is no longer the one that would be written.
  const before = fs.readFileSync(settings);
  assert.equal(set(settings, ['--live-lanes', '9']).code, 0);
  unchanged(apply(file, lanes.id, extra), 'replacement');
  fs.writeFileSync(settings, before);
  // Another repository's settings, even where their line reads the same.
  const other = settingsIn(dir, ['--live-lanes', '2'], 'example-owner/other-repo');
  unchanged(apply(file, lanes.id, ['--settings', other]), 'repository');
  const named = apply(file, lanes.id, ['--settings', other, '--repository', 'example-owner/example-repo']);
  assert.deepEqual([named.code, named.out], [1, '']);
  assert.match(named.err, /^These controller settings are for example-owner\/other-repo, not example-owner\/example-repo/);
  assert.equal(cli(lintModule.main, ['check', '--file', file, '--settings', other, '--repository', 'example-owner/example-repo']).code, 2);
  // Any change elsewhere in the file, the line moved, and another line's number.
  for (const changed of [`${text}More.\n`, `\n${text}`, text.replace('plain', 'Plain'), text.replace(/\n/g, '\r\n')]) {
    fs.writeFileSync(file, changed);
    unchanged(apply(file, lanes.id, extra), JSON.stringify(changed));
    assert.equal(fs.readFileSync(file, 'utf8'), changed);
  }
  fs.writeFileSync(file, text);
  unchanged(apply(file, second.id.replace(/^4/, '3'), extra), 'line number');
  // The tapped line goes, and the same fix again changes nothing.
  const done = apply(file, third.id, extra);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, new RegExp(`^Applied and read back: ${third.id} \\(removed "Keep the changelog short and plain for readers\\."\\)\\.$`, 'm'));
  const left = fs.readFileSync(file, 'utf8');
  assert.equal(left, text.slice(0, text.lastIndexOf('Keep')));
  for (const id of [third.id, second.id, lanes.id]) unchanged(apply(file, id, extra), 'applied before');
  assert.equal(fs.readFileSync(file, 'utf8'), left);
  for (const ids of ['', ',', `${lanes.id},${lanes.id}`]) assert.equal(apply(file, ids, extra).code, 2, ids);
});

test('apply changes only the fixes the owner tapped, all at once, and keeps CRLF and list marks', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir, SPLIT), '--block', 'projects'];
  const { file, findings } = check(dir, THREE_CASES.split('\n').join('\r\n'), extra);
  const at = line => findings.find(finding => finding.line === line);
  const mixed = apply(file, `${at(5).id},${at(6).id},9-duplicate-0000000000000000`, extra);
  assert.equal(mixed.code, 1, 'one fix that is not offered stops them all');
  const applied = apply(file, `${at(6).id},${at(5).id}`, extra);
  assert.equal(applied.code, 0, applied.err);
  const expected = THREE_CASES.split('\n');
  expected.splice(5, 1);
  expected[4] = '- Stack profile: owner-claude';
  assert.equal(fs.readFileSync(file, 'utf8'), expected.join('\r\n'), 'the post format and laptop lines the owner did not tap stay');
  for (const [mark, shown] of [['* ', '* Stack profile: owner-claude'], ['12. ', '12. Stack profile: owner-claude'], ['', 'Stack profile: owner-claude']]) {
    const one = check(dir, `${mark}Stack: owner-claude\n`, extra);
    assert.equal(one.findings[0].fix.with, shown);
    assert.equal(apply(one.file, one.findings[0].id, extra).code, 0);
    assert.equal(fs.readFileSync(one.file, 'utf8'), `${shown}\n`);
    assert.deepEqual(fixes(check(dir, fs.readFileSync(one.file, 'utf8'), extra)), [], 'the settings line is settled');
  }
});

// ---- M3: nothing else changes, and a failed write loses nothing --------------------------------

test('M3: every byte outside the fixed line stays, and a file that is not UTF-8 is refused', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  const bytes = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
  const mark = [0xef, 0xbb, 0xbf];
  for (const [name, before, after] of [
    ['mixed endings', bytes('First.\r\n\r\n- Lanes: 5\r\n\nLast  \n'), bytes('First.\r\n\r\n- Lanes: 2 working lanes (owner, 2026-11-25)\r\n\nLast  \n')],
    ['a byte order mark', bytes(mark, '- Lanes: 5\n- caf', [0xc3, 0xa9], '\n'), bytes(mark, '- Lanes: 2 working lanes (owner, 2026-11-25)\n- caf', [0xc3, 0xa9], '\n')],
    ['no last line end', bytes('First.\r\n\r\n- Lanes: 5'), bytes('First.\r\n\r\n- Lanes: 2 working lanes (owner, 2026-11-25)')],
    ['trailing spaces on the line', bytes('- Lanes: 5  \n- Other.\n'), bytes('- Lanes: 2 working lanes (owner, 2026-11-25)\n- Other.\n')],
  ]) {
    const { file, findings } = check(dir, before, extra);
    const applied = apply(file, findings[0].id, extra);
    assert.equal(applied.code, 0, `${name}: ${applied.err}`);
    assert.deepEqual(fs.readFileSync(file), after, name);
  }
  // Removing the last line of a CRLF file leaves no lone carriage return.
  const rule = 'Keep the changelog short and plain for readers.';
  const last = check(dir, `${rule}\r\n${rule}`);
  assert.equal(apply(last.file, last.findings[0].id).code, 0);
  assert.equal(fs.readFileSync(last.file, 'utf8'), `${rule}\r\n`);
  // Another encoding: not read, not written.
  for (const before of [bytes('- Lanes: 5\r\n- caf', [0xe9], ' notes\r\n'), bytes('- Lanes: 5\n', [0x97], '\n'), Buffer.from([0xff, 0xfe, 0x2d, 0x00]), bytes('- Lanes: 5\n', [0xed, 0xa0, 0x80], '\n')]) {
    const file = path.join(dir, 'other.md');
    fs.writeFileSync(file, before);
    for (const argv of [['check', '--file', file, ...extra], ['apply', '--file', file, ...extra, '--fix', '1-conflicts-setting-0']]) {
      const stopped = cli(lintModule.main, argv);
      assert.equal(stopped.code, argv[0] === 'check' ? 2 : 1);
      assert.match(stopped.err, /not valid UTF-8/);
    }
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test('M3: a failed write keeps the owner\'s file and says what it holds; a write that differs is never called done', t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  const text = `- Lanes: 5\n\n${'owner text.\n'.repeat(200)}`;
  const { file, findings } = check(dir, text, extra);
  const { id } = findings.find(finding => finding.line === 1);
  const run = replacements => withFs(replacements, () => apply(file, id, extra));
  const half = run({ writeFileSync: (target, data, ...rest) => { realWrite(target, String(data).slice(0, 40), ...rest); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
  assert.deepEqual([half.code, half.out, half.err], [1, '', 'The write failed (ENOSPC). The file is unchanged (read back).\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  const busy = run({ renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } });
  assert.deepEqual([busy.code, busy.err], [1, 'The write failed (EBUSY). The file is unchanged (read back).\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  // A rename that replaced the file and still failed, or left other text, is said as it is.
  const landed = run({ renameSync: (from, to) => { realRename(from, to); throw Object.assign(new Error('late'), { code: 'EIO' }); } });
  assert.deepEqual([landed.code, landed.err], [1, 'The write failed (EIO). The file holds the new text (read back).\n']);
  fs.writeFileSync(file, text);
  const torn = run({ renameSync: (from, to) => { realWrite(to, 'half'); throw Object.assign(new Error('late'), { code: 'EIO' }); } });
  assert.deepEqual([torn.code, torn.err], [1, 'The write failed (EIO). The file holds other text than before or after: check it before using it.\n']);
  fs.writeFileSync(file, text);
  // The owner saved the file between the read and the write: their text stays.
  const theirs = `${text}One more line.\n`;
  const raced = run({ writeFileSync: (target, ...rest) => { realWrite(target, ...rest); realWrite(file, theirs); } });
  assert.deepEqual([raced.code, raced.err], [1, 'It changed while this ran, so nothing was written. Run it again.\n']);
  assert.equal(fs.readFileSync(file, 'utf8'), theirs);
  fs.writeFileSync(file, text);
  const wrong = run({ renameSync: (from, to) => { realRename(from, to); realWrite(to, text); } });
  assert.deepEqual([wrong.code, wrong.out], [1, '']);
  assert.match(wrong.err, /did not read back the same/);
  assert.equal(apply(file, id, extra).code, 0);
  assert.deepEqual(fs.readdirSync(dir).filter(name => /tmp/.test(name)), [], 'no temporary file is left');
});

test('a linked owner file stays a link', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, t => {
  const dir = scratch(t);
  const extra = ['--settings', settingsIn(dir)];
  const { file } = check(dir, '- Lanes: 5\n', extra);
  const link = path.join(dir, 'link.md');
  fs.symlinkSync(file, link);
  const { findings } = JSON.parse(cli(lintModule.main, ['check', '--file', link, ...extra, '--json']).out);
  assert.equal(apply(link, findings[0].id, extra).code, 0);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(file, 'utf8'), '- Lanes: 2 working lanes (owner, 2026-11-25)\n');
});

test('check says when it could not run (exit 2), apart from something to settle (1) and nothing to do (0)', t => {
  const dir = scratch(t);
  const settings = settingsIn(dir);
  const file = path.join(dir, 'lines.md');
  const run = (...argv) => cli(lintModule.main, ['check', '--file', file, ...argv]);
  assert.equal(run().code, 2, 'no such file');
  fs.writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
  assert.deepEqual([run().code, run().err], [2, 'The file is over 1 MB, so its owner lines are not read.\n']);
  fs.writeFileSync(file, '- Deploy the staging site after each merge without asking me.\n- Deploy the live site after each merge without asking me.\n');
  assert.equal(run('--settings', `${settings}.none`).code, 2, 'no settings');
  assert.equal(run('--repository', 'example-owner/example-repo').code, 2, '--repository without settings');
  const hint = run('--settings', settings);
  assert.deepEqual([hint.code, /no fix is offered: read both/.test(hint.out)], [0, true], 'a hint alone needs no action');
  fs.writeFileSync(file, 'Keep it small.\n');
  assert.deepEqual([run('--settings', settings).code, run().out], [0, 'Not read (no fix offered; the owner\'s own words): line 1.\n']);
});
