'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Guidebook, parseArgs, main, VERSION_LINE, BASE_PATHS, blobSha } = require('../scripts/toolkit-projects-guidebook.cjs');
const { ProjectsInstructions } = require('../scripts/toolkit-projects-instructions.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SKILL_DIR = path.join(ROOT, 'repo/contracts/claude-projects/web-controller-projects');
const NOW = new Date('2026-10-31T06:00:00.000Z');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidebook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const guidebook = (options = {}) => new Guidebook({ root: ROOT, commit: () => 'abc1234', now: () => NOW, ...options });

function filesIn(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory()
    ? filesIn(path.join(dir, entry.name), base)
    : [path.relative(base, path.join(dir, entry.name)).split(path.sep).join('/')])).sort();
}

function skillVersion() {
  return /^Version: (\S+)$/m.exec(fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'))[1];
}

test('a refresh copies every skill file byte for byte, writes main\'s rendered block and writes VERSION', t => {
  const out = path.join(tmp(t), 'web-controller-projects');
  const result = guidebook().refresh(out);
  const source = filesIn(SKILL_DIR);
  assert.deepEqual(filesIn(out), [...source, 'BASE', 'VERSION', 'instructions-block.md', 'takeover.md'].sort());
  for (const rel of source) assert.ok(fs.readFileSync(path.join(out, rel)).equals(fs.readFileSync(path.join(SKILL_DIR, rel))), rel);
  // The block file is exactly what the instructions renderer prints for main, real marker included.
  const rendered = new ProjectsInstructions({ root: ROOT }).render();
  assert.equal(fs.readFileSync(path.join(out, 'instructions-block.md'), 'utf8'), `${rendered}\n`);
  assert.match(rendered, /^<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN PROJECT-INSTRUCTIONS v2 toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->/);
  const version = fs.readFileSync(path.join(out, 'VERSION'), 'utf8');
  const toolkit = new ProjectsInstructions({ root: ROOT }).expectedBlock().version;
  assert.equal(version, `Version: ${skillVersion()} toolkit ${toolkit} main abc1234 copied 2026-10-31T06:00:00Z\n`);
  assert.match(version, VERSION_LINE);
  assert.deepEqual(result, { version: skillVersion(), toolkit, blockChanged: true });
  assert.deepEqual(guidebook().check(out), { state: 'current', version: skillVersion() });
});

test('VERSION is removed first and written last, so a refresh cut short never looks current', t => {
  const out = path.join(tmp(t), 'copy');
  guidebook().refresh(out);
  const order = [];
  const realWrite = fs.writeFileSync;
  const realRm = fs.rmSync;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => { order.push(`write ${path.basename(file)}`); return realWrite(file, ...rest); });
  t.mock.method(fs, 'rmSync', (file, ...rest) => { order.push(`rm ${path.basename(file)}`); return realRm(file, ...rest); });
  guidebook().refresh(out);
  assert.equal(order[0], 'rm VERSION');
  assert.equal(order.at(-1), 'write VERSION');
  assert.equal(order.filter(entry => entry === 'write VERSION').length, 1);
  // A copy that stopped before its VERSION write reads as missing.
  realRm(path.join(out, 'VERSION'));
  assert.deepEqual(guidebook().check(out), { state: 'missing', reason: 'no VERSION' });
});

test('a second refresh reports no block change, removes files the skill dropped and keeps nothing stale', t => {
  const out = path.join(tmp(t), 'copy');
  guidebook().refresh(out);
  fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(out, 'reference', 'skill-card.md'), 'a file an older skill had\n');
  // A folder an older skill had, nested or not, is removed once the refresh empties it.
  fs.mkdirSync(path.join(out, 'old', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(out, 'old', 'nested', 'gone.md'), 'dropped\n');
  fs.mkdirSync(path.join(out, 'empty'));
  assert.equal(guidebook().refresh(out).blockChanged, false);
  assert.ok(!fs.existsSync(path.join(out, 'reference', 'skill-card.md')));
  assert.ok(!fs.existsSync(path.join(out, 'old')));
  assert.ok(!fs.existsSync(path.join(out, 'empty')));
  assert.ok(fs.existsSync(path.join(out, 'reference')) && fs.existsSync(path.join(out, 'tasks')));
  assert.equal(guidebook().check(out).state, 'current');
  // A changed block on the copy is reported as BLOCK CHANGED by the next refresh.
  fs.writeFileSync(path.join(out, 'instructions-block.md'), 'an older block\n');
  assert.equal(guidebook().refresh(out).blockChanged, true);
});

test('the check names each way a copy is out of date, and never writes', t => {
  const dir = tmp(t);
  const out = path.join(dir, 'copy');
  assert.deepEqual(guidebook().check(out), { state: 'missing', reason: 'no folder' });
  assert.ok(!fs.existsSync(out));
  guidebook().refresh(out);
  const versionFile = path.join(out, 'VERSION');
  const line = fs.readFileSync(versionFile, 'utf8');
  const cases = [
    ['an older skill Version', () => fs.writeFileSync(versionFile, line.replace(/^Version: \S+/, 'Version: 2026-01-01.1')), /^skill 2026-01-01\.1, main /],
    ['an older Toolkit version', () => fs.writeFileSync(versionFile, line.replace(/ toolkit \S+/, ' toolkit 0.0.1')), /^toolkit 0\.0\.1, main /],
    ['an unreadable VERSION', () => fs.writeFileSync(versionFile, 'Version: something else\n'), /^VERSION unreadable$/],
    ['an edited skill file', () => fs.appendFileSync(path.join(out, 'SKILL.md'), 'local edit\n'), /^differs SKILL\.md$/],
    ['a missing reference file', () => fs.rmSync(path.join(out, 'reference', 'setup.md')), /^differs reference\/setup\.md$/],
    ['a today-only check-in', () => fs.writeFileSync(path.join(out, 'tasks', 'daily-check-in.md'), '10. PLUGIN BEHIND: compare with main today.\n'), /^differs tasks\/daily-check-in\.md$/],
    ['an old plugin-card rule', () => fs.writeFileSync(path.join(out, 'reference', 'periodic-runs.md'), 'Keep it pending until current.\n'), /^differs reference\/periodic-runs\.md$/],
    ['an older block', () => fs.writeFileSync(path.join(out, 'instructions-block.md'), 'old\n'), /^differs instructions-block\.md$/],
    ['an edited takeover', () => fs.writeFileSync(path.join(out, 'takeover.md'), 'old\n'), /^differs takeover\.md$/],
    ['a missing takeover', () => fs.rmSync(path.join(out, 'takeover.md')), /^differs takeover\.md$/],
  ];
  for (const [label, damage, reason] of cases) {
    guidebook().refresh(out);
    damage();
    const result = guidebook().check(out);
    assert.equal(result.state, 'stale', label);
    assert.match(result.reason, reason, label);
    guidebook().refresh(out);
    assert.equal(guidebook().check(out).state, 'current', label + ': refresh repairs the copy');
    for (const rel of ['tasks/daily-check-in.md', 'reference/periodic-runs.md']) {
      assert.equal(fs.readFileSync(path.join(out, rel), 'utf8'), fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8'), rel);
    }
  }
});

test('T6 the guidebook writes the canonical takeover byte for byte and checks without writing', t => {
  const out = path.join(tmp(t), 'copy');
  guidebook().refresh(out);
  const canonical = fs.readFileSync(path.join(ROOT, 'repo/docs/agent-playbooks/controller-takeover.md'));
  assert.ok(fs.readFileSync(path.join(out, 'takeover.md')).equals(canonical));
  const published = fs.readFileSync(path.join(out, 'takeover.md'), 'utf8');
  for (const name of ['Read pack', 'Custody pack', 'Record pack', 'Task pack', 'Gate pack']) assert.ok(published.includes(`**${name}:**`), name);
  assert.doesNotMatch(published, /\bR\d+\b/);
  assert.deepEqual([...published.matchAll(/^Pack: (read-example-repo-20261108T0930Z-abcd)\r?$/gm)].map(match => match[1]),
    Array(3).fill('read-example-repo-20261108T0930Z-abcd'));
  fs.writeFileSync(path.join(out, 'takeover.md'), 'damaged\n');
  assert.deepEqual(guidebook().check(out), { state: 'stale', reason: 'differs takeover.md' });
  assert.equal(fs.readFileSync(path.join(out, 'takeover.md'), 'utf8'), 'damaged\n');
  fs.rmSync(path.join(out, 'takeover.md'));
  assert.deepEqual(guidebook().check(out), { state: 'stale', reason: 'differs takeover.md' });
  guidebook().refresh(out);
  assert.ok(fs.readFileSync(path.join(out, 'takeover.md')).equals(canonical));
});

test('the guidebook refuses a second takeover source inside the skill tree', t => {
  const root = tmp(t);
  const dir = path.join(root, 'repo/contracts/claude-projects/web-controller-projects');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `Version: ${skillVersion()}\n`);
  fs.writeFileSync(path.join(dir, 'takeover.md'), 'a second owner\n');
  const canonical = path.join(root, 'repo/docs/agent-playbooks/controller-takeover.md');
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'repo/docs/agent-playbooks/controller-takeover.md'), canonical);
  // Isolate ownership from unrelated rendering: without the duplicate guard this fixture
  // would be accepted and silently copied as another source for the same library path.
  t.mock.method(ProjectsInstructions.prototype, 'render', () => 'block');
  t.mock.method(ProjectsInstructions.prototype, 'expectedBlock', () => ({ version: '3.53.1' }));
  assert.throws(() => guidebook({ root }).expected(), { code: 'GUIDEBOOK_SOURCE' });
});

for (const [rel, contents] of [
  ['reference/controller-takeover.md', 'renamed'],
  ['tasks/Takeover-Notes.MD', 'renamed'],
  ['reference/notes.md', 'canonical'],
  ['reference/notes.md', 'crlf'],
]) {
  test(`the guidebook refuses a second takeover source: ${rel} (${contents}) on every route`, t => {
    const root = tmp(t);
    const dir = path.join(root, 'repo/contracts/claude-projects/web-controller-projects');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `Version: ${skillVersion()}\n`);
    const canonical = path.join(root, 'repo/docs/agent-playbooks/controller-takeover.md');
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'repo/docs/agent-playbooks/controller-takeover.md'), canonical);
    for (const rel of BASE_PATHS) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
    }
    const playbook = fs.readFileSync(canonical, 'utf8').replace(/\r\n/g, '\n');
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Ordinary notes are permitted; only the duplicate content or basename is refused.
    const control = path.join(dir, 'reference/notes.md');
    fs.mkdirSync(path.dirname(control), { recursive: true });
    fs.writeFileSync(control, 'other text\n');
    t.mock.method(ProjectsInstructions.prototype, 'render', () => 'block');
    t.mock.method(ProjectsInstructions.prototype, 'expectedBlock', () => ({ version: '3.53.1' }));
    const book = guidebook({ root });
    const out = path.join(root, 'out');
    assert.ok(book.expected().files.has('reference/notes.md'));
    book.refresh(out);
    assert.equal(book.check(out).state, 'current');
    const before = new Map(filesIn(out).map(file => [file, fs.readFileSync(path.join(out, file))]));
    fs.writeFileSync(target, contents === 'renamed' ? 'a second owner\n' : contents === 'crlf' ? playbook.replace(/\n/g, '\r\n') : playbook);
    for (const operation of [() => book.expected(), () => book.check(out), () => book.refresh(out)]) {
      assert.throws(operation, { code: 'GUIDEBOOK_SOURCE' }, `${rel} (${contents})`);
      assert.deepEqual(filesIn(out), [...before.keys()]);
      for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(out, file)), bytes, file);
    }
  });
}

test('a refresh never takes over a folder it did not write and fails without a usable commit', t => {
  const dir = tmp(t);
  const foreign = path.join(dir, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'notes.md'), 'owner notes\n');
  assert.throws(() => guidebook().refresh(foreign), { code: 'GUIDEBOOK_FOREIGN' });
  assert.equal(fs.readFileSync(path.join(foreign, 'notes.md'), 'utf8'), 'owner notes\n');
  // A file named VERSION or instructions-block.md is not enough: only this script's exact formats
  // claim a folder, so a made-up one never gets the owner's files deleted.
  const fakes = [
    ['VERSION', 'Version: 1\n'],
    ['VERSION', 'anything\n'],
    ['instructions-block.md', 'my own notes about the block\n'],
  ];
  for (const [name, text] of fakes) {
    const folder = path.join(dir, `fake-${fakes.findIndex(entry => entry[1] === text)}`);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, name), text);
    fs.writeFileSync(path.join(folder, 'important.md'), 'keep me\n');
    assert.throws(() => guidebook().refresh(folder), { code: 'GUIDEBOOK_FOREIGN' }, `${name}: ${text}`);
    assert.equal(fs.readFileSync(path.join(folder, 'important.md'), 'utf8'), 'keep me\n');
    assert.equal(fs.readFileSync(path.join(folder, name), 'utf8'), text);
  }
  // A real copy whose refresh stopped after removing VERSION is still this script's to finish.
  const cut = path.join(dir, 'cut-short');
  guidebook().refresh(cut);
  fs.rmSync(path.join(cut, 'VERSION'));
  guidebook().refresh(cut);
  assert.equal(guidebook().check(cut).state, 'current');
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  assert.throws(() => guidebook().refresh(file), { code: 'GUIDEBOOK_OUT' });
  assert.throws(() => guidebook({ commit: () => 'not a sha' }).refresh(path.join(dir, 'new')), { code: 'GUIDEBOOK_COMMIT' });
  assert.ok(!fs.existsSync(path.join(dir, 'new', 'VERSION')));
});

test('the command line prints one result per line and exits 0 only when done or current', t => {
  const out = path.join(tmp(t), 'copy');
  const lines = [];
  t.mock.method(process.stdout, 'write', text => { lines.push(String(text)); return true; });
  t.mock.method(process.stderr, 'write', text => { lines.push(String(text)); return true; });
  assert.equal(main(['--check', out], guidebook()), 1);
  assert.equal(main(['--out', out], guidebook()), 0);
  assert.equal(main(['--out', out], guidebook()), 0);
  assert.equal(main(['--check', out], guidebook()), 0);
  assert.equal(main(['--out'], guidebook()), 2);
  t.mock.restoreAll();
  const toolkit = new ProjectsInstructions({ root: ROOT }).expectedBlock().version;
  assert.deepEqual(lines, [
    'missing no folder\n',
    `SKILL COPY REFRESHED ${skillVersion()}\nBLOCK CHANGED ${toolkit}\n`,
    `SKILL COPY REFRESHED ${skillVersion()}\n`,
    `current ${skillVersion()}\n`,
    'SKILL COPY FAILED GUIDEBOOK_ARGUMENTS\n',
  ]);
  assert.throws(() => parseArgs(['--out', '--check']), { code: 'GUIDEBOOK_ARGUMENTS' });
  assert.throws(() => parseArgs(['--check', out, 'extra']), { code: 'GUIDEBOOK_ARGUMENTS' });
});

test('BASE names the git blob of every base file the Projects controller inherits, CRLF read as LF', t => {
  const out = path.join(tmp(t), 'copy');
  guidebook().refresh(out);
  const lines = fs.readFileSync(path.join(out, 'BASE'), 'utf8').trimEnd().split('\n');
  assert.deepEqual(lines.map(line => line.split(' ')[1]), [...BASE_PATHS]);
  for (const line of lines) {
    const [sha, rel] = line.split(' ');
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(sha, blobSha(fs.readFileSync(path.join(ROOT, rel))), rel);
  }
  // git's own blob id for "hello\n", and the same text with a CRLF ending.
  assert.equal(blobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(blobSha(Buffer.from('hello\r\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  // A copy whose BASE was edited reads as stale, so a coordinator never trusts a hand-made base list.
  fs.writeFileSync(path.join(out, 'BASE'), 'edited\n');
  assert.equal(guidebook().check(out).state, 'stale');
});
