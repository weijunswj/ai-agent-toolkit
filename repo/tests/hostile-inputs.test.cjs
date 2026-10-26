'use strict';

// The shared hostile-input set (support/hostile-inputs.cjs): every family has cases, each case
// holds exactly the code points it names and its source holds none raw, variants yields every
// line-break and byte-order-mark form, timing tells quadratic work from linear, and
// expectDefaultDeny reports accepted cases and stale exceptions.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hostile = require('./support/hostile-inputs.cjs');

test('H-01: every family has cases, ids are unique, and each case holds exactly the code points it names', () => {
  for (const family of hostile.FAMILIES) assert.ok(hostile.cases([family]).length > 0, family);
  const ids = hostile.shapes.map(shape => shape.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const shape of hostile.shapes) {
    assert.ok(hostile.FAMILIES.includes(shape.family), shape.id);
    assert.ok(['yaml', 'shell', 'text'].includes(shape.syntax), shape.id);
    assert.ok(['line', 'start', 'end'].includes(shape.place), shape.id);
    assert.deepEqual(hostile.pointsOf(shape.text), [...shape.points], shape.id);
    assert.ok(Object.isFrozen(shape), shape.id);
    if (shape.bytes) assert.equal(shape.bytes.toString('utf8'), shape.text, shape.id);
  }
  // The shapes the reviews found, by the code points that carry them.
  const has = (id, points) => assert.deepEqual(hostile.shapes.find(shape => shape.id === id).points, points, id);
  has('cr-splits-a-line', [0x0d]);
  has('nel-splits-a-line', [0x85]);
  has('ls-ends-a-comment', [0x2028]);
  has('ps-ends-a-comment', [0x2029]);
  has('crlf-line-end', [0x0d]);
  has('yaml-escaped-nel', [0x85]);
  has('tab-indent', [0x09]);
  has('nbsp-before-comment', [0xa0]);
  has('em-space-before-comment', [0x2003]);
  has('bom-at-start', [0xfeff]);
  has('zero-width-space-in-key', [0x200b]);
  has('cyrillic-look-alike', [0x0441]);
  has('non-breaking-hyphen', [0x2011]);
  has('fullwidth-quote-marker', [0xff1e]);
  has('bad-utf8-bytes', [0xfffd]);
  has('merge-key', []);
  assert.ok(hostile.shapes.find(shape => shape.id === 'utf16-file').points.includes(0x00));
  assert.throws(() => hostile.cases(['no-such-family']), /unknown family/);
});

test('H-02: the source holds only printable ASCII and line ends (LF, or CRLF in a Windows checkout)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'support', 'hostile-inputs.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(hostile.pointsOf(source), []);
});

test('H-03: variants yields every line-break, byte order mark and tab form', () => {
  const text = 'a:\n  b: c\n';
  const out = Object.fromEntries(hostile.variants(text).map(item => [item.id, item.text]));
  assert.deepEqual(Object.keys(out), ['crlf', 'cr', 'nel', 'ls', 'ps', 'bom', 'tabs']);
  for (const [id, end] of Object.entries(hostile.BREAKS)) assert.equal(out[id], `a:${end}  b: c${end}`, id);
  assert.equal(out.bom, `${String.fromCodePoint(0xfeff)}${text}`);
  assert.equal(out.tabs, `a:\n${String.fromCodePoint(0x09)}b: c\n`);
  // indent follows every break shape.
  for (const end of Object.values(hostile.BREAKS)) assert.equal(hostile.indent(`a${end}b`, 2), `  a${end}  b`);
});

test('H-04: timing fails on quadratic work and passes on linear work', () => {
  const started = Date.now();
  const linear = text => { let count = 0; for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 120) count += 1; return count; };
  const quadratic = text => { let count = 0; for (let index = 0; index < text.length; index += 1) count += text.indexOf('x', index); return count; };
  const build = size => 'a'.repeat(size);
  const slow = hostile.timing(quadratic, build, { minMs: 2 });
  assert.equal(slow.ok, false, slow.message);
  const fast = hostile.timing(linear, build, { maxSize: 1 << 22 });
  assert.equal(fast.ok, true, fast.message);
  for (const shape of hostile.cases(['large-input'])) assert.ok(shape.build(1000).length >= 1000, shape.id);
  assert.ok(Date.now() - started < 2000, `timing self-test took ${Date.now() - started} ms`);
});

test('H-05: expectDefaultDeny reports accepted cases and stale or unknown exceptions', () => {
  const list = hostile.cases(['line-breaks']);
  const acceptsCrlf = text => !/\r(?!\n)|[\u0085\u2028\u2029]/.test(text);
  hostile.expectDefaultDeny(assert, acceptsCrlf, list, { allow: ['crlf-line-end'] });
  assert.throws(() => hostile.expectDefaultDeny(assert, acceptsCrlf, list), /accepted/);
  assert.throws(() => hostile.expectDefaultDeny(assert, () => false, list, { allow: ['crlf-line-end'] }), /now refuses/);
  assert.throws(() => hostile.expectDefaultDeny(assert, () => false, list, { allow: ['no-such-case'] }), /not cases/);
});
