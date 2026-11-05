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

// Every case that holds a code point other than printable ASCII and LF, with those code points,
// written out by hand from the case names so the check does not rest on the set's own counting.
const EXPECTED_POINTS = Object.freeze({
  'cr-splits-a-line': [0x0d],
  'nel-splits-a-line': [0x85],
  'ls-splits-a-line': [0x2028],
  'ps-splits-a-line': [0x2029],
  'cr-ends-a-comment': [0x0d],
  'nel-ends-a-comment': [0x85],
  'ls-ends-a-comment': [0x2028],
  'ps-ends-a-comment': [0x2029],
  'cr-after-value-comment': [0x0d],
  'crlf-line-end': [0x0d],
  'crlf-then-lone-cr': [0x0d],
  'shell-backslash-crlf': [0x0d],
  'yaml-escaped-crlf': [0x0d],
  'yaml-escaped-cr': [0x0d],
  'yaml-escaped-nel': [0x85],
  'yaml-escaped-ls': [0x2028],
  'yaml-escaped-ps': [0x2029],
  'tab-indent': [0x09],
  'tab-after-colon': [0x09],
  'nbsp-before-comment': [0xa0],
  'em-space-before-comment': [0x2003],
  'nbsp-after-colon': [0xa0],
  'ideographic-space-after-colon': [0x3000],
  'nbsp-between-words': [0xa0],
  'bom-at-start': [0xfeff],
  'two-boms-at-start': [0xfeff],
  'bom-before-tag-directive': [0xfeff],
  'zero-width-space-in-key': [0x200b],
  'bom-inside-word': [0xfeff],
  'cyrillic-look-alike': [0x0441],
  'non-breaking-hyphen': [0x2011],
  // UTF-16 and UTF-32 read as UTF-8: the byte order mark decodes as replacement characters and
  // every ASCII character carries NUL bytes.
  'utf16-file': [0x00, 0xfffd],
  'utf32-file': [0x00, 0xfffd],
  'bad-utf8-bytes': [0xfffd],
  'guillemet-quote': [0xab, 0xbb],
  'fullwidth-quote-marker': [0xff1e],
});

test('H-01: every family has cases, ids are unique, and each case holds exactly the code points it names', () => {
  for (const family of hostile.FAMILIES) assert.ok(hostile.cases([family]).length > 0, family);
  const ids = hostile.shapes.map(shape => shape.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const shape of hostile.shapes) {
    assert.ok(hostile.FAMILIES.includes(shape.family), shape.id);
    assert.ok(['yaml', 'shell', 'text'].includes(shape.syntax), shape.id);
    assert.ok(['line', 'start', 'end', 'name'].includes(shape.place), shape.id);
    assert.equal(shape.place === 'name', typeof shape.github === 'string' && shape.github.length > 0, `${shape.id} names its GitHub check name exactly when it is a name case`);
    assert.deepEqual(hostile.pointsOf(shape.text), EXPECTED_POINTS[shape.id] || [], shape.id);
    assert.deepEqual([...shape.points], EXPECTED_POINTS[shape.id] || [], shape.id);
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
  for (const id of Object.keys(EXPECTED_POINTS)) assert.ok(ids.includes(id), `${id} is a case`);
  assert.throws(() => hostile.cases(['no-such-family']), /unknown family/);
  assert.throws(() => hostile.cases(['line-breaks'], ['YAML']), /unknown syntax/);
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
  const measure = (cost, options) => {
    let ticks = 0n;
    let reads = 0;
    const samples = [];
    const built = [];
    const result = hostile.timing(text => {
      samples.push(text.length);
      ticks += BigInt(cost(text.length)) * 1000000n;
    }, size => { built.push(size); return 'a'.repeat(size); }, {
      startSize: 2, maxSize: 128, minMs: 8, ...options,
      clock: () => { reads += 1; return ticks; },
    });
    assert.equal(reads, samples.length * 2, 'one start and finish per sample');
    return { result, samples, built };
  };
  for (const [cost, ok, times, ratio, largeRuns] of [
    [size => size, true, [8, 32], 4, 1],
    [size => size * size, false, [64, 1024], 16, 3],
  ]) {
    const { result, samples, built } = measure(cost);
    assert.equal(result.ok, ok, result.message);
    assert.equal(result.ratio, ratio);
    assert.equal(result.size, 8, 'calibration stops at minMs');
    assert.deepEqual(result.times, times);
    assert.match(result.message, /limit 10x/);
    assert.deepEqual(built, [2, 2, 8, 32]);
    assert.deepEqual(samples, [2, 2, 2, 2, 8, 8, 8, ...Array(largeRuns).fill(32)]);
  }
  const capped = measure(size => size, { minMs: 10000 });
  assert.equal(capped.result.size, 32, 'calibration stops before the larger input would exceed maxSize');
  assert.deepEqual(capped.built, [2, 2, 8, 32, 128]);
  assert.deepEqual(capped.samples, [2, 2, 2, 2, 8, 8, 8, 32, 32, 32, 128]);
  const tooFast = measure(() => 0);
  assert.equal(tooFast.result.ok, true, 'below minMs remains a pass');
  assert.deepEqual(tooFast.result.times, [0, 0]);
  assert.equal(tooFast.samples.length, 11, 'zero-duration work still has bounded sampling');
  const boundary = measure(size => size === 32 ? 80 : size);
  assert.equal(boundary.result.ratio, 10);
  assert.equal(boundary.result.ok, true, 'the unchanged ratio threshold is inclusive');
  const above = measure(size => size === 32 ? 81 : size);
  assert.equal(above.result.ok, false, above.result.message);
  assert.equal(above.samples.length, 10, 'over-limit larger runs use all three samples');
  for (const shape of hostile.cases(['large-input'])) {
    const text = shape.build(1000);
    assert.ok(text.length >= 1000, shape.id);
    const keys = text.split('\n').filter(Boolean).map(line => line.split(':')[0]);
    assert.equal(new Set(keys).size, keys.length, `${shape.id} repeats no key`);
  }
});

test('H-05: expectDefaultDeny reports accepted cases and stale or unknown exceptions', () => {
  const list = hostile.cases(['line-breaks']);
  const acceptsCrlf = text => !/\r(?!\n)|[\u0085\u2028\u2029]/.test(text);
  hostile.expectDefaultDeny(assert, acceptsCrlf, list, { allow: ['crlf-line-end'] });
  assert.throws(() => hostile.expectDefaultDeny(assert, acceptsCrlf, list), /accepted/);
  assert.throws(() => hostile.expectDefaultDeny(assert, () => false, list, { allow: ['crlf-line-end'] }), /now refuses/);
  assert.throws(() => hostile.expectDefaultDeny(assert, () => false, list, { allow: ['no-such-case'] }), /not cases/);
  assert.throws(() => hostile.expectDefaultDeny(assert, () => true, []), /no hostile inputs/);
});
