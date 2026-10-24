'use strict';

// Personal-data guard: the closure matrix as table-driven tests.
//   A. surface x event (staged, commit message, pre-push, CI pull_request and push, range)
//   B. detector x variant, each with a near-miss that must not match
//   C. output x path: no stream ever shows a matched value, part of one, or a hash of one
// The installer and hook rows are in personal-data-guard-hooks.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const guard = require('../../skills/secure-ci-cd/scripts/personal-data-guard.cjs');
const {
  BASE_CONFIG, OLE, PNG, TestRepo, assertNoEcho, docxWithSplitRun, markerEmail, pdfWithFlateText, pii, zip,
} = require('./support/personal-data-fixtures.cjs');

const ZERO = '0'.repeat(40);

function rules(text) { return guard.detect(guard.normalise(text).text).map((span) => span.rule); }

// ---------------------------------------------------------------------------------------------
// B. Detector x variant.

test('B: every detector variant matches, and its near-miss does not', () => {
  const rows = [
    // [label, positive text, expected rule, near-miss text]
    ['email plain', `mail ${pii.email()} today`, 'PDG-EMAIL', 'mail jane.tan at mailbox today'],
    ['email uppercase', `MAIL ${pii.email('JANE.TAN', 'MAILBOX.SG')}`, 'PDG-EMAIL', 'MAIL JANE.TAN'],
    ['email plus tag', pii.email('jane+invoices'), 'PDG-EMAIL', 'jane+invoices'],
    ['email IDN', pii.email('jane', 'bücher.de'), 'PDG-EMAIL', 'bücher.de'],
    ['email in mailto', `<a href="mailto:${pii.email()}">`, 'PDG-EMAIL', '<a href="mailto:">'],
    ['reserved domains', pii.email(), 'PDG-EMAIL', `${pii.email('jane', 'example.com')} ${pii.email('a', 'host.test')} ${pii.email('b', 'x.invalid')} ${pii.email('c', 'svc.internal')} ${pii.email('d', 'docs.example')}`],
    ['ssh remote', pii.email(), 'PDG-EMAIL', `git${pii.at}github.com:owner/repo.git and 'git${pii.at}github.com:'`],
    ['url userinfo', pii.email(), 'PDG-EMAIL', `ssh://git${pii.at}github.com/owner/repo.git`],
    ['scoped package', pii.email(), 'PDG-EMAIL', `npm install ${pii.at}types/node ${pii.at}scope/pkg${pii.at}1.2.3`],
    ['decorator and code tokens', pii.email(), 'PDG-EMAIL', `${pii.at}Component() y = x${pii.at}self.weights cc-plugin${pii.at}builtin.options.instructionFiles "\\n${pii.at}AGENTS.md"`],
    ['placeholder', pii.email(), 'PDG-EMAIL', `{ "email": "a${pii.at}b.com" }`],
    ['E.164 US', `call ${pii.e164('1', ' 415 555 0100')}`, 'PDG-PHONE-E164', 'call 415 555'],
    ['E.164 UK', `tel:${pii.e164('44', '2079460958')}`, 'PDG-PHONE-E164', 'tel:+44 20'],
    ['E.164 AU', pii.e164('61', ' 2 9374 4000'), 'PDG-PHONE-E164', 'version 1.0.0+20130313144700'],
    ['SG with plus and spaces', pii.sgPlus(' '), 'PDG-PHONE-E164', '+65 9123'],
    ['SG bare', `phone ${pii.sgBare()}`, 'PDG-PHONE-SG', 'id 65912345'],
    ['SG bare with hyphens', `phone ${pii.sgBare('-')}`, 'PDG-PHONE-SG', 'phone 65-1234-5678'],
    ['SG with NBSP', pii.sgPlus(' '), 'PDG-PHONE-E164', 'sha a1b2c3d4e5f6a7b8c9d06591234567aa'],
    ['SG with en dash', `phone ${pii.sgBare('–')}`, 'PDG-PHONE-SG', 'build 1665912345678'],
    ['SG full-width digits', `phone ${pii.sgBare().replace(/\d/g, (digit) => String.fromCharCode(0xFF10 + Number(digit)))}`, 'PDG-PHONE-SG', 'v65.9123.4567'],
    ['SG with zero-width space', `phone ${pii.sgBare(' ').replace(' ', ' ​')}`, 'PDG-PHONE-SG', '2026-10-23T15:02:38+08:00'],
    ['wa.me link', pii.waMe(), 'PDG-WHATSAPP', 'https://wa.me/message/ABCDEF'],
    ['api.whatsapp.com link', pii.waApi(), 'PDG-WHATSAPP', 'https://api.whatsapp.com/send?text=hi'],
    ['web.whatsapp.com link', pii.waApi().replace('api.', 'web.'), 'PDG-WHATSAPP', 'https://web.whatsapp.com/'],
    ['whatsapp app link', pii.waApi().replace('https://api.whatsapp.com/send', 'whatsapp://send'), 'PDG-WHATSAPP', 'whatsapp://send?text=hi'],
    ['percent-encoded email', `mailto:${pii.email().replace(pii.at, '%40')}`, 'PDG-EMAIL', 'progress 50%40 done'],
    ['entity-encoded email', `<p>${pii.email().replace(pii.at, '&#64;')}</p>`, 'PDG-EMAIL', '<p>&#64;</p>'],
    ['bidi mark in a number', pii.sgPlus(' ').replace(' ', ' \u200E'), 'PDG-PHONE-E164', `at ${pii.plus}2026-10-23 and ${pii.plus}192.168.100.200`],
    ['SG with dots', `phone ${pii.sgBare('.')}`, 'PDG-PHONE-SG', 'v65.9123.4567'],
    ['email in a URL query', `https://mailbox.sg/u?to=${pii.email()}`, 'PDG-EMAIL', `{"remote":"https://deploy${pii.at}git.mailbox.sg/repo"}`],
    ['email before a colon', `${pii.email()}: thanks`, 'PDG-EMAIL', `deploy${pii.at}mailbox.sg:/srv/app`],
    ['asset, version and SQL shapes', pii.email(), 'PDG-EMAIL', `logo${pii.at}2x.png lib${pii.at}2.0.0-beta.rc LIKE '%${pii.at}mailbox.sg'`],
  ];
  for (const [label, positive, rule, nearMiss] of rows) {
    assert.ok(rules(positive).includes(rule), `${label}: ${rule} expected`);
    assert.deepEqual(rules(nearMiss), [], `${label}: near-miss matched`);
  }
});

test('B: a number inside a WhatsApp link is one finding, not two', () => {
  assert.deepEqual(rules(pii.waMe()), ['PDG-WHATSAPP']);
});

test('B: containers are read: a value split across .docx runs and a deflated PDF text stream', () => {
  const value = pii.email();
  const docx = guard.decodeContent('letter.docx', docxWithSplitRun(value));
  assert.deepEqual(docx.unscannable, []);
  assert.ok(docx.parts.some((part) => rules(part.text).includes('PDG-EMAIL')), 'docx split run');
  const pdf = guard.decodeContent('letter.pdf', pdfWithFlateText(value));
  assert.deepEqual(pdf.unscannable, []);
  assert.ok(pdf.parts.some((part) => rules(part.text).includes('PDG-EMAIL')), 'pdf flate stream');
  assert.deepEqual(guard.decodeContent('sheet.xls', OLE).unscannable, ['legacy Office binary']);
  assert.deepEqual(guard.decodeContent('logo.png', PNG).unscannable, ['binary file']);
  assert.deepEqual(guard.decodeContent('data.zip', zip([['a.txt', 'x']])).unscannable, ['zip archive']);
  assert.match(guard.decodeContent('big.bin', Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n')).unscannable[0], /LFS/);
  const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(`note ${value}`, 'utf16le')]);
  assert.ok(rules(guard.decodeContent('notes.txt', utf16).parts[0].text).includes('PDG-EMAIL'), 'UTF-16 text');
});

function pdf(objects) {
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

test('B: Office entries are read by content: comments, CDATA, embedded text and thumbnails', () => {
  const value = pii.email();
  const document = `<?xml version="1.0"?><w:document><!-- ${value} --><w:t><![CDATA[${value}]]></w:t></w:document>`;
  const docx = guard.decodeContent('a.docx', zip([['word/document.xml', document], ['word/embeddings/notes.txt', `call ${pii.sgPlus()}`], ['docProps/thumbnail.jpeg', PNG.toString('latin1')]]));
  const labelled = (label) => docx.parts.filter((part) => part.label === label).flatMap((part) => rules(part.text));
  assert.deepEqual(labelled('word/document.xml'), ['PDG-EMAIL'], 'CDATA is text');
  assert.deepEqual(labelled('word/document.xml markup'), ['PDG-EMAIL'], 'a comment is markup');
  assert.deepEqual(labelled('word/embeddings/notes.txt'), ['PDG-PHONE-E164']);
  assert.deepEqual(docx.unscannable, ['embedded binary docProps/thumbnail.jpeg']);

  // A zip comment that holds a fake end record does not hide the real directory.
  const real = zip([['word/document.xml', `<w:t>${value}</w:t>`]]);
  const comment = Buffer.concat([Buffer.from([0x50, 0x4B, 0x05, 0x06]), Buffer.alloc(18, 0xFF)]);
  const commented = Buffer.concat([real, comment]);
  commented.writeUInt16LE(comment.length, real.length - 2);
  assert.ok(guard.decodeContent('b.docx', commented).parts.some((part) => rules(part.text).includes('PDG-EMAIL')), 'zip with a comment');

  // UTF-16 that is not text is binary.
  assert.deepEqual(guard.decodeContent('x.dat', Buffer.from([0xFF, 0xFE, 0x01, 0x00, 0x02, 0x00])).unscannable, ['binary file']);
});

test('B: PDF strings in UTF-16, ASCIIHex streams, nested dictionaries and Identity fonts', () => {
  const value = pii.email();
  const utf16 = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(value, 'utf16le').swap16()]).toString('hex');
  const hexStream = Buffer.from(`BT <${utf16}> Tj ET`, 'latin1').toString('hex');
  let decoded = guard.decodeContent('a.pdf', pdf([`<< /Length ${hexStream.length + 1} /Filter /ASCIIHexDecode >>\nstream\n${hexStream}>\nendstream`]));
  assert.deepEqual(decoded.unscannable, []);
  assert.ok(decoded.parts.some((part) => rules(part.text).includes('PDG-EMAIL')), 'UTF-16 string in an ASCIIHex stream');

  const flate = zlib.deflateSync(Buffer.from(`BT (${value}) Tj ET`, 'latin1'));
  decoded = guard.decodeContent('b.pdf', Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /DecodeParms << /Columns 1 >> /Length ${flate.length} >>\nstream\n`, 'latin1'),
    flate,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]));
  assert.ok(decoded.parts.some((part) => part.label === 'stream 1' && rules(part.text).includes('PDG-EMAIL')), 'dictionary with a nested dictionary');

  decoded = guard.decodeContent('c.pdf', pdf(['<< /Type /Font /Subtype /Type0 /Encoding /Identity-H >>']));
  assert.match(decoded.unscannable.join(';'), /Identity encoding/);
});

test('B: only introduced lines are checked, and a merge does not re-report its other parent', () => {
  assert.deepEqual(guard.introducedLines(['a', 'b', 'c'], [['a', 'c']]), [1]);
  assert.deepEqual(guard.introducedLines(['a', 'a'], [['a']]), [1]);
  assert.deepEqual(guard.introducedLines(['a', 'x', 'y'], [['a'], ['a', 'x']]), [2]);
  assert.deepEqual(guard.introducedLines(['a'], []), [0]);
});

test('B: config rules: explicit identity choice, role-only allow list, reasons required', () => {
  const ok = guard.validateConfig(structuredClone(BASE_CONFIG));
  assert.equal(ok.identity, 'excluded');
  const broken = [
    { ...BASE_CONFIG, identity: undefined },
    { ...BASE_CONFIG, identity_reason: '' },
    { ...BASE_CONFIG, allow: [{ value: pii.email(), reason: 'a person' }] },
    { ...BASE_CONFIG, allow: [{ value: pii.email('security', 'example.org') }] },
    { ...BASE_CONFIG, not_scanned: [{ path: 'logo.png' }] },
    { ...BASE_CONFIG, required_check: undefined },
    { ...BASE_CONFIG, scope: { ...BASE_CONFIG.scope, file_content: 'yes' } },
    { ...BASE_CONFIG, schema: 'other' },
  ];
  for (const config of broken) assert.throws(() => guard.validateConfig(config), guard.GuardError);
  assert.doesNotThrow(() => guard.validateConfig({ ...BASE_CONFIG, allow: [{ value: pii.email('security', 'mailbox.sg'), reason: 'public security contact' }] }));
});

// ---------------------------------------------------------------------------------------------
// A. Surface x event: staged changes (pre-commit).

function findingLines(result) { return result.all.split('\n').filter((line) => /\bPDG-[A-Z0-9-]+$/.test(line.trim())); }

test('A pre-commit: added hit blocks; deleting a hit, a clean rename and a mode change pass', (t) => {
  const repo = new TestRepo(t);
  const value = markerEmail();
  repo.commit('base', { 'old.txt': `owner ${value}\n`, 'clean.txt': 'nothing here\n' });

  repo.write('notes.txt', `line one\nreach ${value}\n`);
  repo.git(['add', 'notes.txt']);
  let result = repo.guard(['staged']);
  assert.equal(result.status, 1);
  assert.match(result.all, /staged notes\.txt:2:7 {2}email {2}PDG-EMAIL/);
  assertNoEcho(assert, result.all, value, 'staged hit');
  repo.git(['reset', '-q', 'notes.txt']);

  repo.git(['rm', '-q', 'old.txt']);
  result = repo.guard(['staged']);
  assert.equal(result.status, 0, result.all);
  repo.git(['reset', '-q', '--hard']);

  repo.git(['mv', 'clean.txt', 'renamed.txt']);
  assert.equal(repo.guard(['staged']).status, 0);
  repo.git(['reset', '-q', '--hard']);

  repo.git(['update-index', '--chmod=+x', 'old.txt']);
  result = repo.guard(['staged']);
  assert.equal(result.status, 0, 'a mode change introduces no content');
  repo.git(['reset', '-q', '--hard']);

  repo.write('old.txt', `owner ${value}\nnew unrelated line\n`);
  repo.git(['add', 'old.txt']);
  assert.equal(repo.guard(['staged']).status, 0, 'an existing line is not re-reported');
});

test('A pre-commit: a rename to a personal-data file name blocks without showing the name', (t) => {
  const repo = new TestRepo(t);
  const value = markerEmail();
  repo.commit('base', { 'clean.txt': 'nothing here\n' });
  repo.git(['mv', 'clean.txt', `${value}.txt`]);
  const result = repo.guard(['staged']);
  assert.equal(result.status, 1);
  assert.match(result.all, /staged path #1 \(name withheld\)/);
  assertNoEcho(assert, result.all, value, 'path hit');
});

test('A pre-commit: binary, OOXML, PDF and legacy Office files', (t) => {
  const listed = { ...BASE_CONFIG, not_scanned: [{ path: 'docs/*.xls', reason: 'legacy export with no contact data' }, { path: 'img/**', reason: 'icon artwork' }] };
  const repo = new TestRepo(t, { config: listed });
  repo.commit('base', { 'README.md': 'base\n' });
  const value = markerEmail();
  const cases = [
    ['logo.png', PNG, 1, /logo\.png {2}unscannable {2}PDG-UNSCANNABLE/],
    ['img/icons/logo.png', PNG, 0, /img\/icons\/logo\.png: binary file \(listed: icon artwork\)/],
    ['letter.docx', docxWithSplitRun(value), 1, /letter\.docx!word\/document\.xml:1:\d+ {2}email/],
    ['letter.pdf', pdfWithFlateText(value), 1, /letter\.pdf!stream 1:\d+:\d+ {2}email/],
    ['sheet.xls', OLE, 1, /sheet\.xls {2}unscannable/],
    ['docs/sheet.xls', OLE, 0, /docs\/sheet\.xls: legacy Office binary \(listed/],
  ];
  for (const [file, bytes, status, pattern] of cases) {
    repo.write(file, bytes);
    repo.git(['add', file]);
    const result = repo.guard(['staged']);
    assert.equal(result.status, status, `${file}: ${result.all}`);
    assert.match(result.all, pattern, file);
    assertNoEcho(assert, result.all, value, file);
    repo.git(['reset', '-q', file]);
    fs.rmSync(path.join(repo.root, file));
  }
});

test('A pre-commit: allow markers need a reason and are counted; role addresses on the allow list pass', (t) => {
  const role = pii.email('security', 'mailbox.sg');
  const repo = new TestRepo(t, { config: { ...BASE_CONFIG, allow: [{ value: role, reason: 'public security contact' }] } });
  repo.commit('base', { 'README.md': 'base\n' });
  repo.write('a.txt', `fixture ${pii.email()} personal-data-guard: allow synthetic value for a parser test\n`);
  repo.write('b.txt', `report to ${role}\n`);
  repo.git(['add', 'a.txt', 'b.txt']);
  let result = repo.guard(['staged']);
  assert.equal(result.status, 0, result.all);
  assert.match(result.all, /Allow markers used: 1\./);
  repo.write('a.txt', `fixture ${pii.email()} personal-data-guard: allow\n`);
  repo.git(['add', 'a.txt']);
  result = repo.guard(['staged']);
  assert.equal(result.status, 1);
  assert.match(result.all, /a\.txt:1:9 {2}allow-marker {2}PDG-ALLOW-NO-REASON/);
});

// ---------------------------------------------------------------------------------------------
// A. Commit messages (commit-msg).

test('A commit-msg: a hit in the subject, body, trailer or a comment line blocks; removed and context diff lines do not', (t) => {
  const repo = new TestRepo(t);
  const value = markerEmail();
  const cases = [
    [`Fix for ${value}\n`, 1],
    ['Fix parser\n\nReported by a user.\nReach them at ' + value + '\n', 1],
    [`Fix parser\n\nReported-by: Jane <${value}>\n`, 1],
    [`Fix parser\n\nCall ${pii.sgPlus()}\n`, 1],
    // The comment character is configurable and --cleanup=verbatim keeps comment lines.
    [`Fix parser\n# ${value} in a comment line\n`, 1],
    [`Fix parser\n# ------------------------ >8 ------------------------\n+${value}\n`, 1],
    [`Fix parser\n; ------------------------ >8 ------------------------\n-${value}\n ${value}\n`, 0],
  ];
  for (const [message, status] of cases) {
    const file = repo.write('.git/COMMIT_EDITMSG', message);
    const result = repo.guard(['message', file]);
    assert.equal(result.status, status, message);
    assertNoEcho(assert, result.all, value, 'commit message');
    if (status) assert.match(result.all, /commit message:\d+:\d+ {2}(?:email|phone)/);
  }
});

// ---------------------------------------------------------------------------------------------
// A. pre-push.

function pushRepo(t) {
  const remote = new TestRepo(t, { config: null, bare: true });
  const repo = new TestRepo(t);
  repo.git(['remote', 'add', 'origin', remote.root]);
  const base = repo.commit('base', { 'README.md': 'base\n' });
  repo.git(['push', '-q', '--no-verify', 'origin', 'main']);
  return { repo, base };
}

test('A pre-push: new branch, fast-forward, force-push, delete, annotated tag and several refs', (t) => {
  const { repo, base } = pushRepo(t);
  const value = markerEmail();

  // New branch: every commit not on a remote-tracking ref, including a hit later removed.
  repo.git(['checkout', '-q', '-b', 'feature']);
  repo.commit('add contact', { 'c.txt': `${value}\n` });
  const clean = repo.commit('remove contact', { 'c.txt': 'removed\n' });
  let result = repo.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${clean} refs/heads/feature ${ZERO}\n` });
  assert.equal(result.status, 1, 'new branch with a hit in a middle commit');
  assert.match(result.all, /Checked: 2 commit\(s\)/);
  assertNoEcho(assert, result.all, value, 'pre-push new branch');

  // Fast-forward: a hit already on the remote is not re-reported; only the new commits are checked.
  repo.git(['push', '-q', '--no-verify', 'origin', 'feature']);
  const next = repo.commit('more', { 'd.txt': 'clean\n' });
  result = repo.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${next} refs/heads/feature ${clean}\n` });
  assert.equal(result.status, 0, result.all);
  assert.match(result.all, /Checked: 1 commit\(s\)/);

  // Force-push: the remote commit is not an ancestor; the replacement history is checked.
  repo.git(['checkout', '-q', '-B', 'feature', base]);
  const forced = repo.commit('rewrite', { 'e.txt': `${pii.sgBare()}\n` });
  result = repo.guard(['pre-push', 'origin'], { input: `refs/heads/feature ${forced} refs/heads/feature ${clean}\n` });
  assert.equal(result.status, 1);
  assert.match(result.all, /e\.txt:1:1 {2}phone {2}PDG-PHONE-SG/);

  // Branch delete: nothing to check.
  result = repo.guard(['pre-push', 'origin'], { input: `(delete) ${ZERO} refs/heads/feature ${next}\n` });
  assert.equal(result.status, 0);
  assert.match(result.all, /a ref deletion has no content to check/);

  // Annotated tag: its message is checked.
  repo.git(['checkout', '-q', 'main']);
  repo.git(['tag', '-a', 'v1', '-m', `release for ${value}`]);
  const tag = repo.git(['rev-parse', 'v1']);
  result = repo.guard(['pre-push', 'origin'], { input: `refs/tags/v1 ${tag} refs/tags/v1 ${ZERO}\n` });
  assert.equal(result.status, 1);
  assert.match(result.all, /tag [0-9a-f]{12} message:1:\d+ {2}email/);
  assertNoEcho(assert, result.all, value, 'tag message');

  // Several refs in one push: each one is checked.
  repo.git(['checkout', '-q', '-b', 'second', base]);
  const second = repo.commit('second', { 'f.txt': 'clean\n' });
  result = repo.guard(['pre-push', 'origin'], { input: `refs/heads/second ${second} refs/heads/second ${ZERO}\nrefs/heads/feature ${forced} refs/heads/feature ${clean}\n` });
  assert.equal(result.status, 1);
  assert.match(result.all, /Checked: 2 commit\(s\)/);

  // Malformed input and a missing remote argument fail closed.
  assert.equal(repo.guard(['pre-push', 'origin'], { input: 'not a ref line\n' }).status, 2);
  assert.equal(repo.guard(['pre-push'], { input: `refs/heads/second ${second} refs/heads/second ${ZERO}\n` }).status, 2);
});

test('A pre-push: only the pushed-to remote\'s tracking refs are trusted; a URL remote has none', (t) => {
  const { repo, base } = pushRepo(t);
  const mirror = new TestRepo(t, { config: null, bare: true });
  repo.git(['remote', 'add', 'mirror', mirror.root]);
  const value = markerEmail();
  repo.git(['checkout', '-q', '-b', 'private', base]);
  const hit = repo.commit('private notes', { 'p.txt': `${value}\n` });
  repo.git(['push', '-q', '--no-verify', 'mirror', 'private']);
  const line = `refs/heads/private ${hit} refs/heads/private ${ZERO}\n`;
  let result = repo.guard(['pre-push', 'origin'], { input: line });
  assert.equal(result.status, 1, 'a commit on another remote is still new to origin');
  assertNoEcho(assert, result.all, value, 'pre-push other remote');
  assert.equal(repo.guard(['pre-push', 'mirror'], { input: line }).status, 0, 'already on the mirror');
  result = repo.guard(['pre-push', mirror.root], { input: line });
  assert.equal(result.status, 1, 'a push to a URL trusts no tracking ref');
});

test('A pre-push: nested annotated tags are all read; a tag of a blob fails closed', (t) => {
  const { repo } = pushRepo(t);
  const value = markerEmail();
  repo.git(['tag', '-a', 'inner', '-m', `inner note ${value}`]);
  repo.git(['tag', '-a', 'outer', '-m', 'outer note', 'inner']);
  const outer = repo.git(['rev-parse', 'outer']);
  let result = repo.guard(['pre-push', 'origin'], { input: `refs/tags/outer ${outer} refs/tags/outer ${ZERO}\n` });
  assert.equal(result.status, 1);
  assert.match(result.all, /tag [0-9a-f]{12} message:1:\d+ {2}email/);
  assertNoEcho(assert, result.all, value, 'nested tag');
  const blob = repo.git(['hash-object', '-w', '--stdin'], { input: 'data\n' });
  repo.git(['tag', '-a', 'blobtag', '-m', 'a blob', blob]);
  const blobTag = repo.git(['rev-parse', 'blobtag']);
  result = repo.guard(['pre-push', 'origin'], { input: `refs/tags/blobtag ${blobTag} refs/tags/blobtag ${ZERO}\n` });
  assert.equal(result.status, 2);
  assert.match(result.all, /points to something other than a commit/);
});

// ---------------------------------------------------------------------------------------------
// A. CI events.

function ciRun(repo, name, event) {
  const file = repo.write(`../event-${Date.now()}-${Math.random().toString(16).slice(2)}.json`, JSON.stringify(event));
  return repo.guard(['ci'], { env: { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: file } });
}

function prRepo(t) {
  const repo = new TestRepo(t);
  const base = repo.commit('base', { 'README.md': 'base\n' });
  repo.git(['update-ref', 'refs/remotes/origin/main', base]);
  repo.git(['checkout', '-q', '-b', 'feature']);
  return { repo, base };
}

test('A CI pull_request: a hit in a middle commit later removed, in the title or body; fork; missing base', (t) => {
  const { repo, base } = prRepo(t);
  const value = markerEmail();
  repo.commit('one', { 'a.txt': 'clean\n' });
  repo.commit('two', { 'a.txt': `clean\n${value}\n` });
  const head = repo.commit('three', { 'a.txt': 'clean\n' });
  const pr = (extra = {}) => ({ pull_request: { title: 'Parser fix', body: 'Fixes the parser.', base: { sha: base }, head: { sha: head, ref: 'feature' }, ...extra } });

  let result = ciRun(repo, 'pull_request', pr());
  assert.equal(result.status, 1);
  assert.match(result.all, /commit [0-9a-f]{12} a\.txt:2:1 {2}email/);
  assert.match(result.all, /These commits are already on GitHub/);
  assert.doesNotMatch(result.all, /force-push to fix|run git push --force/i);
  assertNoEcho(assert, result.all, value, 'pr middle commit');

  // The same range from a reviewer's check gives the same verdict and findings.
  const range = repo.guard(['range', `${base}..${head}`]);
  assert.equal(range.status, result.status);
  assert.deepEqual(findingLines(range), findingLines(result));

  repo.git(['checkout', '-q', '-B', 'clean', base]);
  const cleanHead = repo.commit('clean', { 'b.txt': 'ok\n' });
  const cleanPr = (extra) => ({ pull_request: { title: 'Parser fix', body: null, base: { sha: base }, head: { sha: cleanHead, ref: 'clean', repo: { fork: true } }, ...extra } });
  result = ciRun(repo, 'pull_request', cleanPr());
  assert.equal(result.status, 0, `fork pull request with a null body: ${result.all}`);
  result = ciRun(repo, 'pull_request', cleanPr({ title: `Contact ${value}` }));
  assert.equal(result.status, 1);
  assert.match(result.all, /pull request title:1:9 {2}email/);
  result = ciRun(repo, 'pull_request', cleanPr({ body: `Steps\n\nwhatsapp ${pii.waMe()}` }));
  assert.equal(result.status, 1);
  assert.match(result.all, /pull request body:3:\d+ {2}whatsapp-link/);
  result = ciRun(repo, 'pull_request', cleanPr({ base: { sha: 'f'.repeat(40) } }));
  assert.equal(result.status, 2, 'a missing base commit (shallow clone) fails closed');
  assert.match(result.all, /COULD NOT SCAN/);
});

test('A CI push: new branch, squash commit message, merge commits, branch delete, unsupported event', (t) => {
  const { repo, base } = prRepo(t);
  const value = markerEmail();
  const event = (extra) => ({ ref: 'refs/heads/feature', before: ZERO, after: ZERO, repository: { default_branch: 'main' }, ...extra });

  const hit = repo.commit('feature work', { 'a.txt': `${pii.sgPlus()}\n` });
  let result = ciRun(repo, 'push', event({ after: hit }));
  assert.equal(result.status, 1, 'new branch without a pull request');

  repo.git(['checkout', '-q', 'main']);
  const squash = repo.commit(`Parser fix (#12)\n\nCo-authored-by: Jane <${value}>`, { 'b.txt': 'clean\n' });
  result = ciRun(repo, 'push', event({ ref: 'refs/heads/main', before: base, after: squash }));
  assert.equal(result.status, 1, 'default-branch squash commit message');
  assert.match(result.all, /message:3:\d+ {2}email/);
  assertNoEcho(assert, result.all, value, 'squash message');

  // A merge brings in a clean branch: passes. Lines that came from the other parent are not
  // re-reported, but a line the merge itself adds is.
  repo.git(['checkout', '-q', '-B', 'side', base]);
  const side = repo.commit('side', { 'c.txt': 'side line\n' });
  repo.git(['checkout', '-q', 'main']);
  repo.git(['merge', '-q', '--no-ff', '--no-verify', '-m', 'Merge side', 'side']);
  const merge = repo.git(['rev-parse', 'HEAD']);
  result = ciRun(repo, 'push', event({ ref: 'refs/heads/main', before: squash, after: merge }));
  assert.equal(result.status, 0, `merge commit on the default branch: ${result.all}`);
  assert.match(result.all, /Checked: 2 commit\(s\)/);
  repo.commit('legacy contact list', { 'legacy.txt': `${value}\n` });
  repo.git(['checkout', '-q', '-B', 'evil', side]);
  repo.git(['merge', '-q', '--no-ff', '--no-commit', 'main'], { allowFailure: true });
  repo.write('c.txt', `side line\n${value}\n`);
  repo.git(['add', 'c.txt']);
  repo.git(['commit', '-q', '--no-verify', '-m', 'Merge main']);
  const evil = repo.git(['rev-parse', 'HEAD']);
  result = repo.guard(['range', evil, '--not', 'main']);
  assert.equal(result.status, 1);
  assert.deepEqual(findingLines(result).map((line) => line.trim().split(/\s+/)[2]), ['c.txt:2:1'], 'only the line the merge itself adds');

  result = ciRun(repo, 'push', event({ before: hit, after: ZERO, deleted: true }));
  assert.equal(result.status, 0, 'branch delete');
  result = ciRun(repo, 'workflow_dispatch', {});
  assert.equal(result.status, 2, 'unsupported events fail closed');
});

test('A CI push: a replaced history falls back to every commit not on the default branch, visibly', (t) => {
  const { repo } = prRepo(t);
  const head = repo.commit('rewritten', { 'a.txt': 'clean\n' });
  const result = ciRun(repo, 'push', { ref: 'refs/heads/feature', before: 'e'.repeat(40), after: head, repository: { default_branch: 'main' } });
  assert.equal(result.status, 0, result.all);
  assert.match(result.all, /history was replaced/);
});

test('A CI pull_request: a change cannot switch off checks for itself; added entries are named', (t) => {
  const repo = new TestRepo(t);
  const configFile = '.github/personal-data-guard.json';
  const base = repo.commit('base', { [configFile]: `${JSON.stringify(BASE_CONFIG, null, 2)}\n`, 'README.md': 'base\n' });
  repo.git(['checkout', '-q', '-b', 'feature']);
  const weaker = { ...BASE_CONFIG, scope: { ...BASE_CONFIG.scope, file_content: false }, not_scanned: [{ path: 'art/*.png', reason: 'icon artwork' }] };
  const head = repo.commit('quiet the guard', { [configFile]: `${JSON.stringify(weaker, null, 2)}\n`, 'a.txt': `${pii.email()}\n` });
  const event = { pull_request: { title: 'Tidy', body: '', base: { sha: base }, head: { sha: head, ref: 'feature' } } };
  let result = ciRun(repo, 'pull_request', event);
  assert.equal(result.status, 1, result.all);
  assert.match(result.all, /the change switches off file content; the base commit's setting was used/);
  assert.match(result.all, /the change adds art\/\*\.png to not_scanned: icon artwork/);
  result = repo.guard(['range', `${base}..${head}`]);
  assert.equal(result.status, 1, 'a reviewer range check keeps the base setting too');
});

test('A range and CI: a shallow clone fails closed instead of reading the cut as a rewrite', (t) => {
  const origin = new TestRepo(t);
  const base = origin.commit('base', { 'README.md': 'base\n' });
  const head = origin.commit('next', { 'a.txt': 'clean\n' });
  const shallow = new TestRepo(t);
  fs.rmSync(shallow.root, { recursive: true, force: true });
  shallow.git(['clone', '-q', '--depth', '1', `file://${origin.root}`, shallow.root], { cwd: shallow.dir });
  shallow.write('.github/personal-data-guard.json', `${JSON.stringify(BASE_CONFIG)}\n`);
  let result = shallow.guard(['range', `${base}..${head}`]);
  assert.equal(result.status, 2, result.all);
  assert.match(result.all, /this clone is shallow/);
  result = ciRun(shallow, 'push', { ref: 'refs/heads/main', before: base, after: head, repository: { default_branch: 'main' } });
  assert.equal(result.status, 2, 'a push event in a shallow clone is not a replaced history');
  assert.doesNotMatch(result.all, /history was replaced/);
});

test('A range: the spec needs exactly two dots and two ends', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  for (const spec of ['HEAD...HEAD', 'HEAD..HEAD..HEAD', '..HEAD', 'HEAD..']) {
    assert.equal(repo.guard(['range', spec]).status, 2, spec);
  }
});

test('A identity included: the whole author line is read, name included', (t) => {
  const repo = new TestRepo(t, { config: { ...BASE_CONFIG, identity: 'included', identity_reason: undefined } });
  const base = repo.commit('base', { 'README.md': 'base\n' });
  repo.write('b.txt', 'clean\n');
  repo.git(['add', 'b.txt']);
  repo.git(['commit', '-q', '--no-verify', '-m', 'clean', `--author=Jane ${pii.sgPlus()} <author${pii.at}example.invalid>`]);
  const result = repo.guard(['range', `${base}..HEAD`]);
  assert.equal(result.status, 1, result.all);
  assert.match(result.all, /commit [0-9a-f]{12} author:1:1 {2}phone/);
});

test('A tree: whole content at a revision, with the listed gaps printed', (t) => {
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n', 'docs/a.md': `${pii.email()}\n` });
  const result = repo.guard(['tree']);
  assert.equal(result.status, 1);
  assert.match(result.all, /docs\/a\.md:1:1 {2}email/);
  assert.match(result.all, /Not scanned:/);
});

// ---------------------------------------------------------------------------------------------
// C. Output x path: the marker value never reaches any stream.

function capture(argv, options = {}) {
  let out = '';
  let err = '';
  const status = guard.main(argv, { ...options, out: { write: (text) => { out += text; } }, err: { write: (text) => { err += text; } } });
  return { status, all: `${out}${err}` };
}

test('C: success, hit, config error, git error, unreadable file, container error and crash never echo', (t) => {
  const value = markerEmail();
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  const configPath = path.join(repo.root, '.github', 'personal-data-guard.json');

  const paths = [];
  paths.push(['success', repo.guard(['tree']), 0]);
  repo.write('hit.txt', `${value}\n`);
  repo.git(['add', 'hit.txt']);
  paths.push(['hit', repo.guard(['staged']), 1]);
  repo.git(['reset', '-q', 'hit.txt']);

  const badConfig = repo.write('../bad-config.json', `{ "schema": "${value}" `);
  paths.push(['config parse error', repo.guard(['staged', '--config', badConfig]), 2]);
  const wrongConfig = repo.write('../wrong-config.json', JSON.stringify({ ...BASE_CONFIG, allow: [{ value, reason: 'personal' }] }));
  paths.push(['config validation error', repo.guard(['staged', '--config', wrongConfig]), 2]);
  paths.push(['git error', repo.guard(['range', `${value}..HEAD`]), 2]);
  paths.push(['unreadable file', repo.guard(['message', path.join(repo.root, `${value}.msg`)]), 2]);

  const damaged = zip([['word/document.xml', `<w:t>${value}</w:t>`]]).subarray(0, 40);
  repo.write('broken.docx', damaged);
  repo.git(['add', 'broken.docx']);
  paths.push(['container parse error', repo.guard(['staged']), 1]);
  repo.git(['reset', '-q', 'broken.docx']);

  paths.push(['crash', capture(['staged', '--repo', repo.root, '--config', configPath], {
    spawn: () => { throw new Error(`boom ${value}`); },
  }), 2]);
  paths.push(['git stderr', capture(['range', 'a..b', '--repo', repo.root, '--config', configPath], {
    spawn: () => ({ status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from(`fatal: bad revision ${value}`) }),
  }), 2]);
  paths.push(['pull request env missing', capture(['pr', '--repo', repo.root, '--config', configPath], { env: { PDG_PR_BODY: value } }), 2]);

  for (const [label, result, status] of paths) {
    assert.equal(result.status, status, `${label}: ${result.all}`);
    assertNoEcho(assert, result.all, value, label);
  }
});

test('C: arguments, event names, config paths and config text never echo', (t) => {
  const value = markerEmail();
  const repo = new TestRepo(t);
  repo.commit('base', { 'README.md': 'base\n' });
  const reason = repo.write('../reason-config.json', JSON.stringify({ ...BASE_CONFIG, identity_reason: `ask ${value}` }));
  const listed = repo.write('../listed-config.json', JSON.stringify({ ...BASE_CONFIG, not_scanned: [{ path: `${value}.png`, reason: 'artwork' }] }));
  const event = repo.write('../event.json', '{}');
  const paths = [
    ['unknown option', repo.guard(['staged', `--${value}`])],
    ['unknown mode', repo.guard([value])],
    ['missing config path', repo.guard(['staged', '--config', path.join(repo.dir, `${value}.json`)])],
    ['config reason', repo.guard(['staged', '--config', reason])],
    ['config path entry', repo.guard(['staged', '--config', listed])],
    ['event name', repo.guard(['ci'], { env: { GITHUB_EVENT_NAME: value, GITHUB_EVENT_PATH: event } })],
  ];
  for (const [label, result] of paths) {
    assert.equal(result.status, 2, `${label}: ${result.all}`);
    assertNoEcho(assert, result.all, value, label);
  }
});

test('C: explain prints the rules and the not-scanned gaps without needing a scan', (t) => {
  const repo = new TestRepo(t);
  const result = repo.guard(['explain']);
  assert.equal(result.status, 0);
  for (const id of Object.keys(guard.RULES)) assert.match(result.all, new RegExp(id));
  assert.match(result.all, /never contains a matched value/);
});
