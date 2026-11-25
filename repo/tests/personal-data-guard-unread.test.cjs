'use strict';

// Images and fonts pass the personal data guard unread where the settings' pass_unread names them, and the
// report names each one. What a file is goes by its bytes as well as its name: types by extensions,
// mismatches, readable text, deletes, renames and history commits, in every mode. Any other file the guard
// cannot read fails until its path is listed. Throwaway repositories and fake values only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const installer = require('../../skills/secure-ci-cd/scripts/install-personal-data-guard.cjs');
const guard = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');
const { OLE, TestRepo, assertNoEcho, pii, zip } = require('./support/personal-data-fixtures.cjs');

const CONFIG = '.github/personal-data-guard.json';
const person = pii.email();
const settings = (extra = {}) => ({ ...JSON.parse(installer.configText()), ...extra });
const text = config => `${JSON.stringify(config, null, 2)}\n`;

// ---- the smallest real file of each type ---------------------------------------------------------

const u16 = (value, little = false) => { const out = Buffer.alloc(2); if (little) out.writeUInt16LE(value); else out.writeUInt16BE(value); return out; };
const u32 = (value, little = false) => { const out = Buffer.alloc(4); if (little) out.writeUInt32LE(value); else out.writeUInt32BE(value); return out; };
const ascii = value => Buffer.from(value, 'latin1');
const zeros = count => Buffer.alloc(count);

function png() {
  const chunk = (type, data) => Buffer.concat([u32(data.length), ascii(type), data, u32(zlib.crc32(Buffer.concat([ascii(type), data])))]);
  return Buffer.concat([ascii('\x89PNG\r\n\x1A\n'), chunk('IHDR', Buffer.concat([u32(1), u32(1), Buffer.from([8, 2, 0, 0, 0])])), chunk('IDAT', zlib.deflateSync(zeros(4))), chunk('IEND', zeros(0))]);
}
const sfnt = version => Buffer.concat([version, u16(1), zeros(6), ascii('head'), zeros(4), u32(28), u32(8), zeros(8)]);
const woff = version => Buffer.concat([ascii(version), u32(0x00010000), u32(48), zeros(36)]);
const ico = Buffer.concat([u16(0), u16(1, true), u16(1, true), Buffer.from([16, 16, 0, 0]), u16(1, true), u16(32, true), u32(8, true), u32(22, true), zeros(8)]);
const TYPES = {
  png: png(),
  jpeg: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), u16(16), ascii('JFIF\0'), zeros(9), Buffer.from([0xFF, 0xD9])]),
  'older gif': Buffer.concat([ascii('GIF87a'), u16(1, true), u16(1, true), zeros(3), ascii(';')]),
  gif: Buffer.concat([ascii('GIF89a'), u16(1, true), u16(1, true), zeros(3), ascii(';')]),
  webp: Buffer.concat([ascii('RIFF'), u32(20, true), ascii('WEBPVP8 '), u32(8, true), zeros(8)]),
  avif: Buffer.concat([u32(20), ascii('ftypavif'), zeros(4), ascii('mif1'), zeros(8)]),
  ico,
  woff: woff('wOFF'),
  woff2: woff('wOF2'),
  ttf: sfnt(Buffer.from([0, 1, 0, 0])),
  otf: sfnt(ascii('OTTO')),
};
// Other things a file can be, none of which ever passes unread, whatever its name.
const OTHERS = {
  zip: zip([['a.txt', 'text']]), gzip: Buffer.concat([zlib.gzipSync('text'), zeros(4)]), office: OLE, exe: Buffer.concat([ascii('MZ'), zeros(60)]),
  sqlite: Buffer.concat([ascii('SQLite format 3\0'), zeros(84)]), access: Buffer.concat([Buffer.from([0, 1, 0, 0]), ascii('Standard Jet DB\0'), zeros(64)]),
  'encrypted pdf': ascii('%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF\n'), bmp: Buffer.concat([ascii('BM'), zeros(60)]), tiff: Buffer.concat([ascii('II*\0'), zeros(60)]),
  heic: Buffer.concat([u32(20), ascii('ftypheic'), zeros(24)]), mp4: Buffer.concat([u32(20), ascii('ftypisom'), zeros(24)]), wav: Buffer.concat([ascii('RIFF'), u32(20, true), ascii('WAVEfmt '), zeros(12)]),
  'font collection': Buffer.concat([ascii('ttcf'), zeros(40)]), binary: Buffer.concat([zeros(8), Buffer.from([1, 2, 3, 4]), zeros(20)]),
  'a cut PNG': ascii('\x89PNG\r\n\x1A\n\0\0\0'), 'a PNG start and nothing else': Buffer.concat([ascii('\x89PNG\r\n\x1A\n'), zeros(40)]), 'a JPEG start and nothing else': Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0x00]), zeros(20)]),
  'a webp longer than the file': Buffer.concat([ascii('RIFF'), u32(4000, true), ascii('WEBPVP8 '), zeros(12)]), 'an avif box longer than the file': Buffer.concat([u32(4000), ascii('ftypavif'), zeros(12)]),
  'a woff of another length': Buffer.concat([woff('wOFF'), ascii('PK\x03\x04'), zeros(20)]), 'a woff2 of another length': Buffer.concat([woff('wOF2'), zeros(20)]),
  'a font with a table outside': Buffer.concat([Buffer.from([0, 1, 0, 0]), u16(1), zeros(6), ascii('head'), zeros(4), u32(28), u32(4000), zeros(8)]), 'a font with no tables': Buffer.concat([ascii('OTTO'), zeros(40)]),
  'a font with a table over its header': Buffer.concat([Buffer.from([0, 1, 0, 0]), u16(1), zeros(6), ascii('head'), zeros(4), u32(0), u32(8), zeros(8)]),
  'an icon with a picture outside': Buffer.concat([u16(0), u16(1, true), u16(1, true), Buffer.from([16, 16, 0, 0]), zeros(4), u32(4000, true), u32(22, true), zeros(8)]), 'an icon with no pictures': Buffer.concat([u16(0), u16(1, true), zeros(30)]),
};
const EXTENSIONS = { png: ['.png'], jpeg: ['.jpg', '.jpeg'], 'older gif': ['.gif'], gif: ['.gif'], webp: ['.webp'], avif: ['.avif'], ico: ['.ico'], woff: ['.woff'], woff2: ['.woff2'], ttf: ['.ttf'], otf: ['.otf'] };
const KINDS = { images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico'], fonts: ['.woff', '.woff2', '.ttf', '.otf'] };
const safe = name => name.replace(/ /g, '-');

// ---- running the guard ---------------------------------------------------------------------------

function inProcess(repo, args, options = {}) {
  let all = '';
  const write = value => { all += value; return true; };
  return { status: guard.main([...args, '--repo', repo.root], { out: { write }, err: { write }, ...options }), all };
}

function guarded(t, config = settings()) {
  const repo = new TestRepo(t, { config });
  return { repo, base: repo.commit('Start', { [CONFIG]: text(config), 'README.md': 'App\n' }) };
}

const commitAll = (repo, files, message = 'Change') => {
  for (const [file, bytes] of Object.entries(files)) repo.write(file, bytes);
  repo.git(['add', '-A']);
  repo.git(['commit', '-q', '--no-verify', '-m', message]);
  return repo.git(['rev-parse', 'HEAD']);
};
const passed = all => [...all.matchAll(/^ {2}- (?:commit [0-9a-f]{12} |staged |file )?(.*): not read, let through as one of the (images|fonts)$/gm)].map(match => [match[1], match[2]]);
const failed = all => [...all.matchAll(/^ {2}(?:commit [0-9a-f]{12} |staged |file )?(.*?) {2}unscannable {2}PDG-UNSCANNABLE$/gm)].map(match => match[1]);

function pullRequest(repo, base) {
  const event = path.join(repo.dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 5, title: 'Add a file', body: 'A file.', head: { sha: repo.git(['rev-parse', 'HEAD']), ref: 'feature' }, base: { sha: base, ref: 'main' } }, repository: { default_branch: 'main' } }));
  return inProcess(repo, ['ci'], { env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event } });
}

// ---- the table -----------------------------------------------------------------------------------

test('the one list is small: these images and these fonts, and the default settings name both kinds', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(guard.PASS_UNREAD).map(([kind, list]) => [kind, Object.keys(list)])), KINDS);
  assert.deepEqual(settings().pass_unread, ['images', 'fonts']);
  assert.deepEqual([settings().allow, settings().not_scanned], [[], []], 'a Dependabot sign-off needs no entry: it is an author line');
});

test('every type under every extension: only a file whose bytes are what its name says passes, and it is named', t => {
  const { repo, base } = guarded(t);
  const files = {}, expected = [];
  const names = [...new Set(Object.values(EXTENSIONS).flat()), '.bin', '', '.svg', '.zip', '.pdf', '.bmp', '.svgz'];
  for (const [type, bytes] of Object.entries({ ...TYPES, ...OTHERS })) {
    for (const extension of names) {
      const file = `files/${safe(type)}-as-${extension.slice(1) || 'nothing'}${extension}`;
      files[file] = bytes;
      if (EXTENSIONS[type]?.includes(extension)) expected.push([file, KINDS.images.includes(extension) ? 'images' : 'fonts']);
    }
  }
  files['files/UPPER.PNG'] = TYPES.png;
  expected.push(['files/UPPER.PNG', 'images']);
  commitAll(repo, files);
  const result = pullRequest(repo, base);
  assert.equal(result.status, 1);
  assert.deepEqual(passed(result.all).sort(), expected.sort());
  const refused = Object.keys(files).filter(file => !expected.some(([name]) => name === file));
  // A PDF is read as one under any name; an encrypted one cannot be read.
  assert.deepEqual(failed(result.all).sort(), refused.sort());
  assert.match(result.all, new RegExp(`^Let through unread: ${expected.length} file version\\(s\\), each named above\\. A reviewer opens each one\\.$`, 'm'));
  // The pull request that holds only the matching ones passes.
  const clean = guarded(t);
  commitAll(clean.repo, Object.fromEntries(expected.map(([file]) => [file, files[file]])));
  const ok = pullRequest(clean.repo, clean.base);
  assert.equal(ok.status, 0, ok.all);
  assert.equal(passed(ok.all).length, expected.length);
  assert.match(ok.all, /Result: PASS/);
});

test('readable text is scanned as text whatever its name, an SVG included', t => {
  const utf16 = value => Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(value, 'utf16le')]);
  const names = [...new Set(Object.values(EXTENSIONS).flat()), '.svg'].map(extension => `art/picture${extension}`);
  const words = guarded(t);
  commitAll(words.repo, Object.fromEntries(names.map(file => [file, `<svg><text>clean ${file}</text></svg>\n`])));
  let read = inProcess(words.repo, ['range', `${words.base}..HEAD`]);
  assert.equal(read.status, 0, read.all);
  assert.deepEqual(passed(read.all), [], 'read, so not named as unread');
  commitAll(words.repo, Object.fromEntries(names.map(file => [file, `<svg>\n<text>${file} ${person}</text></svg>\n`])));
  read = inProcess(words.repo, ['range', 'HEAD~1..HEAD']);
  assert.equal(read.status, 1);
  for (const file of names) assert.match(read.all, new RegExp(`${file.replace('.', '[.]')}:2:\\d+ {2}email {2}PDG-EMAIL`), file);
  assertNoEcho(assert, read.all, person, 'text');
  const { repo, base } = guarded(t);
  // A magic word in front does not make text a picture.
  commitAll(repo, { 'a.gif': `GIF89a ${person}\n`, 'b.ttf': utf16(`one ${person}\n`), 'c.otf': `OTTO ${person}\n`, 'd.woff': `wOFF ${person}\n` });
  const result = inProcess(repo, ['range', `${base}..HEAD`]);
  for (const file of ['a.gif', 'b.ttf', 'c.otf', 'd.woff']) assert.match(result.all, new RegExp(`${file.replace('.', '[.]')}:1:\\d+ {2}email`), file);
  // A Git LFS pointer is text about content that is not in git.
  const lfs = guarded(t);
  commitAll(lfs.repo, { 'big.png': 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n' });
  assert.deepEqual(failed(inProcess(lfs.repo, ['range', `${lfs.base}..HEAD`]).all), ['big.png']);
  // A submodule or a picture inside a document is no image file.
  const other = guarded(t);
  other.repo.git(['update-index', '--add', '--cacheinfo', `160000,${other.base},logo.png`]);
  other.repo.commit('Add a submodule');
  other.repo.commit('Add a letter', { 'letter.docx': zip([['[Content_Types].xml', '<Types/>'], ['word/media/image1.png', TYPES.png.toString('latin1')]]) });
  assert.deepEqual(failed(inProcess(other.repo, ['range', `${other.base}..HEAD`]).all).sort(), ['letter.docx', 'logo.png']);
});

test('every commit counts: adds, changes, deletes, renames, copies and merges', t => {
  const { repo, base } = guarded(t);
  const check = (from, expectPassed, expectFailed, name) => {
    const result = inProcess(repo, ['range', `${from}..HEAD`]);
    assert.deepEqual(passed(result.all).map(([file]) => file), expectPassed, `${name}: ${result.all}`);
    assert.deepEqual(failed(result.all), expectFailed, name);
    assert.equal(result.status, expectFailed.length ? 1 : 0, name);
    return result;
  };
  const step = (files, name) => { const from = repo.git(['rev-parse', 'HEAD']); commitAll(repo, files, name); return from; };
  check(step({ 'logo.png': TYPES.png, 'font.ttf': TYPES.ttf }, 'add'), ['font.ttf', 'logo.png'], [], 'add');
  check(step({ 'logo.png': Buffer.concat([TYPES.png, zeros(4)]) }, 'change'), ['logo.png'], [], 'change');
  let from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['mv', 'logo.png', 'mark.png']);
  commitAll(repo, {}, 'rename');
  check(from, ['mark.png'], [], 'a rename inside the type');
  from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['mv', 'mark.png', 'mark.dat']);
  commitAll(repo, {}, 'rename away');
  check(from, [], ['mark.dat'], 'a rename to another name');
  from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['mv', 'mark.dat', 'mark.gif']);
  commitAll(repo, {}, 'rename to another image');
  check(from, [], ['mark.gif'], 'a rename to another type');
  from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['rm', '-q', 'mark.gif', 'font.ttf']);
  commitAll(repo, {}, 'delete');
  check(from, [], [], 'a delete');
  check(step({ 'bundle.zip': OTHERS.zip }, 'archive'), [], ['bundle.zip'], 'an archive');
  from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['mv', 'bundle.zip', 'bundle.png']);
  commitAll(repo, {}, 'rename an archive');
  check(from, [], ['bundle.png'], 'an archive renamed to an image');
  // A mode or type change to a link is text.
  from = repo.git(['rev-parse', 'HEAD']);
  repo.git(['rm', '-q', 'bundle.png']);
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo.root, env: repo.env, input: 'target', encoding: 'utf8' }).stdout.trim();
  repo.git(['update-index', '--add', '--cacheinfo', `120000,${blob},link.png`]);
  repo.git(['commit', '-q', '--no-verify', '-m', 'link']);
  check(from, [], [], 'a link');
  // A later commit hides nothing: the wrong file and the text in an earlier commit are still found, and a
  // passed file that is gone again is still named.
  repo.git(['reset', '-q', '--hard', base]);
  step({ 'a.png': `${person}\n`, 'b.png': OTHERS.exe, 'c.png': TYPES.png }, 'first');
  step({ 'a.png': TYPES.png, 'b.png': TYPES.png }, 'replaced');
  repo.git(['rm', '-q', 'a.png', 'b.png', 'c.png']);
  commitAll(repo, {}, 'gone');
  const result = inProcess(repo, ['range', `${base}..HEAD`]);
  assert.equal(result.status, 1);
  assert.deepEqual(failed(result.all), ['b.png']);
  assert.match(result.all, /a\.png:1:1 {2}email/);
  assert.deepEqual(passed(result.all).map(([file]) => file), ['c.png', 'a.png', 'b.png']);
  // A merge that brings in a passed file names it at its own commit; one the merge itself changes, at the merge.
  repo.git(['reset', '-q', '--hard', base]);
  repo.git(['checkout', '-q', '-B', 'side']);
  step({ 'side.png': TYPES.png }, 'side');
  repo.git(['checkout', '-q', 'main']);
  step({ 'main.woff2': TYPES.woff2 }, 'main');
  repo.git(['merge', '-q', '--no-ff', '--no-commit', '--no-verify', 'side']);
  repo.write('side.png', OTHERS.zip);
  commitAll(repo, {}, 'Bring side in');
  const joined = inProcess(repo, ['range', `${base}..HEAD`]);
  assert.deepEqual(passed(joined.all).map(([file]) => file).sort(), ['main.woff2', 'side.png']);
  assert.deepEqual(failed(joined.all), ['side.png'], 'the merge put an archive in its place');
});

test('every mode lets the same files through and names them: staged, pushed, checked, the whole tree and the sweep', t => {
  const { repo, base } = guarded(t);
  repo.write('logo.png', TYPES.png);
  repo.git(['add', 'logo.png']);
  const named = (result, name) => { assert.equal(result.status, 0, `${name}: ${result.all}`); assert.deepEqual(passed(result.all), [['logo.png', 'images']], name); };
  named(inProcess(repo, ['staged']), 'staged');
  repo.git(['commit', '-q', '--no-verify', '-m', 'Add the logo']);
  const head = repo.git(['rev-parse', 'HEAD']);
  named(inProcess(repo, ['pre-push', 'origin'], { stdin: () => `refs/heads/feature ${head} refs/heads/feature ${base}\n` }), 'pre-push');
  named(inProcess(repo, ['range', `${base}..HEAD`]), 'range');
  named(inProcess(repo, ['range', 'HEAD', '--not', base]), 'range --not');
  named(pullRequest(repo, base), 'pull request');
  const event = path.join(repo.dir, 'push.json');
  fs.writeFileSync(event, JSON.stringify({ ref: 'refs/heads/main', before: base, after: head, repository: { default_branch: 'main' } }));
  named(inProcess(repo, ['ci'], { env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event } }), 'push');
  named(inProcess(repo, ['tree']), 'tree');
  const spawn = (command, args, options) => (command === 'gh' ? { status: 0, stdout: '', stderr: '' } : spawnSync(command, args, options));
  const sweep = inProcess(repo, ['sweep', '--github', 'acme/app'], { spawn, env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '' } });
  named(sweep, 'sweep');
  assert.match(sweep.all, /Result: REPORT ONLY, 0 found \(0 in files, 0 in commit messages, 0 in pull request text, 0 in comments\), 1 not readable\n$/, 'still counted as not read');
  // A name that holds a value is withheld, and the value is a finding of its own.
  const hidden = guarded(t);
  commitAll(hidden.repo, { [`by ${person}/logo.png`]: TYPES.png });
  const result = inProcess(hidden.repo, ['range', `${hidden.base}..HEAD`]);
  assert.equal(result.status, 1);
  assert.deepEqual(passed(result.all), [['path #1 (name withheld)', 'images']]);
  assertNoEcho(assert, result.all, person, 'a path');
});

test('the owner\'s own settings win: none, one kind, a listed path, and switched-off scope', t => {
  const files = { 'logo.png': TYPES.png, 'font.woff2': TYPES.woff2 };
  const without = settings();
  delete without.pass_unread;
  for (const [name, config, passes] of [
    ['settings from before', without, []],
    ['an empty list', settings({ pass_unread: [] }), []],
    ['images only', settings({ pass_unread: ['images'] }), ['logo.png']],
    ['fonts only', settings({ pass_unread: ['fonts'] }), ['font.woff2']],
    ['both', settings(), ['font.woff2', 'logo.png']],
  ]) {
    const { repo, base } = guarded(t, config);
    commitAll(repo, files);
    const result = inProcess(repo, ['range', `${base}..HEAD`]);
    assert.deepEqual(passed(result.all).map(([file]) => file), passes, name);
    assert.deepEqual(failed(result.all), Object.keys(files).sort().filter(file => !passes.includes(file)), name);
    assert.equal(result.status, passes.length === 2 ? 0 : 1, name);
    for (const kind of ['images', 'fonts']) assert.ok(result.all.includes(`- ${kind} (${KINDS[kind].join(', ')}): ${(config.pass_unread || []).includes(kind) ? 'let through unread when the bytes match the name, and each one named here' : 'reported as unscannable'}`), `${name}: ${kind}`);
  }
  // A listed path keeps its own reason, and lets through what is listed as before.
  const listed = guarded(t, settings({ not_scanned: [{ path: '*.png', reason: 'our artwork' }] }));
  commitAll(listed.repo, { 'logo.png': TYPES.png, 'other.png': OTHERS.zip });
  const result = inProcess(listed.repo, ['range', `${listed.base}..HEAD`]);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(passed(result.all), []);
  assert.match(result.all, /logo\.png: binary file \(listed: our artwork\)/);
  const off = guarded(t, settings({ scope: { ...settings().scope, file_content: false } }));
  commitAll(off.repo, files);
  assert.deepEqual(passed(inProcess(off.repo, ['range', `${off.base}..HEAD`]).all), []);
  // A setting the guard does not know stops it; it never guesses.
  for (const bad of ['images', ['pictures'], ['images', 'images'], [null], { images: true }, ['__proto__'], ['archives']]) {
    const { repo } = guarded(t, settings({ pass_unread: bad }));
    const stopped = inProcess(repo, ['tree']);
    assert.equal(stopped.status, 2, JSON.stringify(bad));
    assert.match(stopped.all, /pass_unread must be a list of "images" and "fonts", each at most once/);
  }
});

test('a change cannot let its own files through unread, and can always stop', t => {
  const without = settings();
  delete without.pass_unread;
  const { repo, base } = guarded(t, without);
  commitAll(repo, { [CONFIG]: text(settings()), 'logo.png': TYPES.png });
  let result = pullRequest(repo, base);
  assert.equal(result.status, 1);
  assert.match(result.all, /Note: the change lets images and fonts through unread; the base commit's setting was used for this check/);
  assert.deepEqual(failed(result.all), ['logo.png']);
  // Once it landed, the next change goes by it.
  const landed = repo.git(['rev-parse', 'HEAD']);
  commitAll(repo, { 'next.png': TYPES.png });
  result = pullRequest(repo, landed);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(passed(result.all), [['next.png', 'images']]);
  // Taking it out counts at once.
  const before = repo.git(['rev-parse', 'HEAD']);
  commitAll(repo, { [CONFIG]: text(without), 'last.png': TYPES.png });
  assert.deepEqual(failed(pullRequest(repo, before).all), ['last.png']);
  // A first adoption has no earlier settings to go by.
  const fresh = new TestRepo(t, { config: null });
  const start = fresh.commit('Start', { 'README.md': 'App\n' });
  commitAll(fresh, { [CONFIG]: installer.configText(), 'logo.png': TYPES.png });
  result = pullRequest(fresh, start);
  assert.equal(result.status, 0, result.all);
  assert.deepEqual(passed(result.all), [['logo.png', 'images']]);
});

test('a file over the size limit goes by its bytes too', t => {
  const { repo, base } = guarded(t);
  const big = 25 * 1024 * 1024 + 1;
  commitAll(repo, { 'big.png': Buffer.concat([TYPES.png, zeros(big)]), 'big.ttf': Buffer.alloc(big, 'a'), 'big.gif': Buffer.concat([ascii('GIF89a'), Buffer.alloc(big, 'a')]), 'big.zip': Buffer.concat([ascii('PK\x03\x04'), zeros(big)]) });
  const result = inProcess(repo, ['range', `${base}..HEAD`]);
  assert.deepEqual(passed(result.all), [['big.png', 'images']]);
  assert.deepEqual(failed(result.all).sort(), ['big.gif', 'big.ttf', 'big.zip']);
});
