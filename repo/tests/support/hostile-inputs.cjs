'use strict';

// A shared set of hostile input shapes for readers that make a safety decision from YAML, shell
// or free text. Every shape here once made a reader see something different from what GitHub, a
// YAML parser or the shell would see. A default-deny reader must refuse each one (answer refused,
// unverified or unreadable), unless its test names the case as an allowed exception.
//
// This file holds data and assertion helpers only. It never decides whether an input is safe.
// Every character outside printable ASCII is built at runtime from its code point, so this source
// holds no raw invisible, look-alike or line-break characters.
//
// A case is { id, family, syntax, text, points, place }:
//   family  one of FAMILIES;
//   syntax  the language the text is written in: 'yaml', 'shell' or 'text' (free text);
//   text    the input; YAML cases are entries of a mapping at indent 0 (place 'line'), or go at
//           the start or the end of a whole document (place 'start' or 'end');
//   points  every code point in the text other than printable ASCII and LF, sorted and unique,
//           so a test can prove each case holds exactly the characters it names;
//   bytes   for byte-level cases, the raw bytes; text is how a UTF-8 read sees them.
// Large-input cases also carry build(size), which returns the input at about `size` characters.

const cp = (...points) => String.fromCodePoint(...points);

const CR = cp(0x0d);
const TAB = cp(0x09);
const NEL = cp(0x85);
const LS = cp(0x2028);
const PS = cp(0x2029);
const BOM = cp(0xfeff);
const NBSP = cp(0xa0);
const EM_SPACE = cp(0x2003);
const IDEO_SPACE = cp(0x3000);
const ZWSP = cp(0x200b);
const NB_HYPHEN = cp(0x2011);
const CYRILLIC_ES = cp(0x0441);
const LEFT_GUILLEMET = cp(0xab);
const RIGHT_GUILLEMET = cp(0xbb);
const FULLWIDTH_GT = cp(0xff1e);
const BS = '\\';
const BACKTICK = '`';

// Line breaks some parser honours beyond LF, keyed by name.
const BREAKS = Object.freeze({ crlf: `${CR}\n`, cr: CR, nel: NEL, ls: LS, ps: PS });

const FAMILIES = Object.freeze([
  'line-breaks',
  'continued-lines',
  'quoting',
  'yaml-structure',
  'indents',
  'invisible',
  'free-text',
  'large-input',
]);

const HIDDEN = 'continue-on-error: true';

function pointsOf(text) {
  const found = new Set();
  for (const char of String(text)) {
    const point = char.codePointAt(0);
    if (point !== 0x0a && (point < 0x20 || point > 0x7e)) found.add(point);
  }
  return [...found].sort((a, b) => a - b);
}

function make(family, syntax, id, text, extra = {}) {
  return Object.freeze({ id, family, syntax, text, points: Object.freeze(pointsOf(text)), place: 'line', ...extra });
}

const yaml = (family, id, text, extra) => make(family, 'yaml', id, text, extra);
const shell = (family, id, text) => make(family, 'shell', id, text);
const prose = (family, id, text) => make(family, 'text', id, text);

const lineBreaks = [
  ...['cr', 'nel', 'ls', 'ps'].map(name => yaml('line-breaks', `${name}-splits-a-line`, `id: x${BREAKS[name]}${HIDDEN}`)),
  ...['cr', 'nel', 'ls', 'ps'].map(name => yaml('line-breaks', `${name}-ends-a-comment`, `# note${BREAKS[name]}${HIDDEN}`)),
  yaml('line-breaks', 'cr-after-value-comment', `id: x # note${CR}${HIDDEN}`),
  yaml('line-breaks', 'crlf-line-end', `id: x${CR}\ntimeout-minutes: 5`),
  yaml('line-breaks', 'crlf-then-lone-cr', `id: x${CR}\ntimeout-minutes: 5${CR}${HIDDEN}`),
];

const continuedLines = [
  shell('continued-lines', 'shell-backslash-newline', `node a.cjs ${BS}\n|| true`),
  shell('continued-lines', 'shell-backslash-crlf', `node a.cjs ${BS}${CR}\n|| true`),
  shell('continued-lines', 'powershell-backtick-newline', `node a.cjs ${BACKTICK}\n; exit 0`),
  shell('continued-lines', 'graphql-multi-line-query', `gh api graphql -f query='\nmutation { mergePullRequest(input: {}) { clientMutationId } }'`),
  ...Object.entries({ lf: '\n', ...BREAKS }).map(([name, end]) => yaml('continued-lines', `yaml-escaped-${name}`, `id: "x${BS}${end}  ${HIDDEN}"`)),
  yaml('continued-lines', 'value-on-next-line', 'continue-on-error:\n  true'),
  yaml('continued-lines', 'uses-on-next-line', 'uses:\n  ./local-action'),
  yaml('continued-lines', 'plain-value-folded', 'id: x\n  continue-on-error: true'),
];

const quoting = [
  yaml('quoting', 'double-quoted-key', `"continue-on-error": true`),
  yaml('quoting', 'single-quoted-key', `'continue-on-error': true`),
  yaml('quoting', 'quoted-uses-key', `"uses": ./local-action`),
  yaml('quoting', 'quoted-on-key', `"on": push`),
  yaml('quoting', 'doubled-single-quote', `id: 'it''s'`),
  ...[['x', 'x63'], ['u', 'u0063'], ['U', 'U00000063']].map(([name, code]) => yaml('quoting', `escape-${name}-in-key`, `"${BS}${code}ontinue-on-error": true`)),
  ...[['N', 'N'], ['underscore', '_'], ['L', 'L'], ['P', 'P'], ['slash', '/'], ['backslash', BS]].map(([name, code]) => yaml('quoting', `escape-${name}-in-value`, `id: "a${BS}${code}b"`)),
  yaml('quoting', 'single-quote-in-plain-before-comment', `id: x' #'`),
  yaml('quoting', 'double-quote-in-plain-before-comment', 'id: a "b #c"'),
  yaml('quoting', 'yaml-number-name', 'name: 1.10'),
  yaml('quoting', 'yaml-boolean-name', 'name: True'),
  prose('quoting', 'git-quoted-path', `"docs/${BS}303${BS}251.md"`),
];

const structure = [
  yaml('yaml-structure', 'anchor-on-key', `&a ${HIDDEN}`),
  yaml('yaml-structure', 'alias-value', 'continue-on-error: *t'),
  yaml('yaml-structure', 'dotted-anchor', 'with: &f.1\n  a: b'),
  yaml('yaml-structure', 'alias-list-item', 'with:\n  - *step'),
  yaml('yaml-structure', 'alias-steps', 'steps: *s'),
  yaml('yaml-structure', 'merge-key', '<<: *base'),
  yaml('yaml-structure', 'tag-on-key', `!!str ${HIDDEN}`),
  yaml('yaml-structure', 'tag-on-value', 'continue-on-error: !!bool true'),
  yaml('yaml-structure', 'binary-tag', 'id: !!binary dHJ1ZQ=='),
  yaml('yaml-structure', 'verbatim-tag', 'id: !<tag:yaml.org,2002:%62inary> dHJ1ZQ=='),
  yaml('yaml-structure', 'tag-directive', '%TAG ! tag:example.test,2026:\n---\n', { place: 'start' }),
  yaml('yaml-structure', 'explicit-key', '? continue-on-error\n: true'),
  yaml('yaml-structure', 'flow-mapping', 'with: {A: b}'),
  yaml('yaml-structure', 'flow-list-comma-first', 'with: [\n  , a]'),
  yaml('yaml-structure', 'flow-list-comment-between', 'with: [a, # c\n  b]'),
  ...['>-', '|-', '|2-', '>2-'].map(header => yaml('yaml-structure', `block-scalar-${header}`, `id: ${header}\n  x`)),
  ...['~', 'null', 'Null', 'NULL', ''].map(spelling => yaml('yaml-structure', `null-${spelling || 'empty'}`, `continue-on-error:${spelling ? ` ${spelling}` : ''}`)),
  yaml('yaml-structure', 'indented-later-document', `---\n  ${HIDDEN}\n`, { place: 'end' }),
  yaml('yaml-structure', 'second-document', `---\n${HIDDEN}\n`, { place: 'end' }),
  yaml('yaml-structure', 'document-end-marker', `...\n${HIDDEN}\n`, { place: 'end' }),
  yaml('yaml-structure', 'duplicate-key', `continue-on-error: false\n${HIDDEN}`),
  yaml('yaml-structure', 'space-before-colon', 'continue-on-error : true'),
];

const indents = [
  yaml('indents', 'tab-indent', `with:\n${TAB}A: b`),
  yaml('indents', 'tab-after-colon', `continue-on-error:${TAB}true`),
  yaml('indents', 'odd-indent', 'with:\n   A: b'),
  yaml('indents', 'nbsp-before-comment', `id: x${NBSP}# note`),
  yaml('indents', 'em-space-before-comment', `id: x${EM_SPACE}# note`),
  yaml('indents', 'nbsp-after-colon', `continue-on-error:${NBSP}true`),
  yaml('indents', 'ideographic-space-after-colon', `continue-on-error:${IDEO_SPACE}true`),
  shell('indents', 'nbsp-between-words', `node a.cjs${NBSP}--force`),
];

const UTF16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('id: x\n', 'utf16le')]);
const UTF32 = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), ...[...'id: x\n'].map(char => Buffer.from([char.charCodeAt(0), 0, 0, 0]))]);
const BAD_UTF8 = Buffer.concat([Buffer.from('id: x'), Buffer.from([0xc3, 0x28]), Buffer.from('\n')]);

const invisible = [
  yaml('invisible', 'bom-at-start', BOM, { place: 'start' }),
  yaml('invisible', 'two-boms-at-start', `${BOM}${BOM}`, { place: 'start' }),
  yaml('invisible', 'bom-before-tag-directive', `${BOM}%TAG ! tag:example.test,2026:\n---\n`, { place: 'start' }),
  yaml('invisible', 'zero-width-space-in-key', `continue-on-error${ZWSP}: true`),
  yaml('invisible', 'bom-inside-word', `contin${BOM}ue-on-error: true`),
  yaml('invisible', 'cyrillic-look-alike', `${CYRILLIC_ES}ontinue-on-error: true`),
  yaml('invisible', 'non-breaking-hyphen', `continue${NB_HYPHEN}on-error: true`),
  yaml('invisible', 'utf16-file', UTF16.toString('utf8'), { place: 'start', bytes: UTF16 }),
  yaml('invisible', 'utf32-file', UTF32.toString('utf8'), { place: 'start', bytes: UTF32 }),
  yaml('invisible', 'bad-utf8-bytes', BAD_UTF8.toString('utf8'), { bytes: BAD_UTF8 }),
];

const freeText = [
  prose('free-text', 'list-oxford-comma', 'merge PRs 612, 613, and 614'),
  prose('free-text', 'list-with-or', 'merge PRs 612, 613 or 614'),
  prose('free-text', 'list-starts-in-link-text', 'merge [PR 612](https://example.test/612), 613'),
  prose('free-text', 'count-after-number', 'merge 622 once 3 checks pass'),
  prose('free-text', 'number-with-suffix', 'approve #461-and-later'),
  prose('free-text', 'quoted-line', '> merge 622'),
  prose('free-text', 'list-marker-before-quote', '- > merge 622'),
  prose('free-text', 'guillemet-quote', `${LEFT_GUILLEMET}merge 622${RIGHT_GUILLEMET}`),
  prose('free-text', 'fullwidth-quote-marker', `${FULLWIDTH_GT} merge 622`),
  prose('free-text', 'refusal-cancelled', 'merge 622 cancelled'),
  prose('free-text', 'refusal-holding', 'holding the merge of 622'),
  prose('free-text', 'condition-should-ci-pass', 'merge 622 should CI pass'),
];

const largeInput = [
  ['long-line', size => `name: ${'a'.repeat(size)}\n`],
  ['space-run', size => `name: a${' '.repeat(size)}b\n`],
  ['space-run-before-comment', size => `name: a${' '.repeat(size)}#${' '.repeat(size)}\n`],
  ['many-short-lines', size => Array.from({ length: Math.max(1, Math.ceil(size / 11)) }, (_, index) => `k${String(index).padStart(6, '0')}: b\n`).join('')],
].map(([id, build]) => yaml('large-input', id, build(64), { build }));

const shapes = Object.freeze([...lineBreaks, ...continuedLines, ...quoting, ...structure, ...indents, ...invisible, ...freeText, ...largeInput]);

const SYNTAXES = Object.freeze(['yaml', 'shell', 'text']);

// The cases of the given families (and, optionally, syntaxes). An unknown name throws, so a typo
// never yields an empty list that every reader passes.
function cases(families, syntaxes = null) {
  const wanted = new Set(families);
  for (const family of wanted) if (!FAMILIES.includes(family)) throw new Error(`unknown family ${family}`);
  for (const syntax of syntaxes || []) if (!SYNTAXES.includes(syntax)) throw new Error(`unknown syntax ${syntax}`);
  return shapes.filter(shape => wanted.has(shape.family) && (!syntaxes || syntaxes.includes(shape.syntax)));
}

// `text` (written with LF) rewritten with every other line-break shape, with a leading byte
// order mark, and with tabs for leading indents (one tab for every two spaces):
// [{ id, text }] for crlf, cr, nel, ls, ps, bom and tabs.
function variants(text) {
  const source = String(text);
  return [
    ...Object.entries(BREAKS).map(([id, end]) => ({ id, text: source.split('\n').join(end) })),
    { id: 'bom', text: `${BOM}${source}` },
    { id: 'tabs', text: source.split('\n').map(line => line.replace(/^ +/, spaces => TAB.repeat(Math.ceil(spaces.length / 2)))).join('\n') },
  ];
}

// Every line of `text` after the first, and the first too, indented by `spaces`, where a line
// starts after any break in BREAKS or LF, so a hidden line lands at the indent of its neighbours.
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return pad + String(text).replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, end => end + pad);
}

// A large-input check: times fn(build(size)) and fn(build(size * 4)), growing size until the
// smaller run takes at least minMs or the larger would pass maxSize, and fails when the time grows
// by more than maxRatio (linear work grows about fourfold, quadratic about sixteenfold).
// The larger size stops repeating once a run is within the limit, so a linear reader is timed
// once there. Returns { ok, ratio, size, times, message }.
function timing(fn, build, { startSize = 1024, maxSize = 1 << 20, minMs = 20, maxRatio = 10, runs = 3 } = {}) {
  const time = (size, count, enough = -1) => {
    const input = build(size);
    let best = Infinity;
    for (let run = 0; run < count && best > enough; run += 1) {
      const started = process.hrtime.bigint();
      fn(input);
      best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
    }
    return best;
  };
  time(startSize, 1);
  let size = startSize;
  let small = time(size, runs);
  while (small < minMs && size * 16 <= maxSize) {
    size *= 4;
    small = time(size, runs);
  }
  const large = time(size * 4, runs, Math.max(small, 0.5) * maxRatio);
  const ratio = large / Math.max(small, 0.5);
  const ok = large < minMs || ratio <= maxRatio;
  return { ok, ratio, size, times: [small, large], message: `size ${size} took ${small.toFixed(1)} ms, size ${size * 4} took ${large.toFixed(1)} ms (growth ${ratio.toFixed(1)}x, limit ${maxRatio}x)` };
}

// Asserts that `accepts(text, shape)` is false for every case except the ids in `allow`, and that
// every allowed id is a real case the reader does accept, so the exception list stays honest. An
// empty list fails: it would prove nothing.
function expectDefaultDeny(assert, accepts, list, { allow = [] } = {}) {
  assert.ok(Array.isArray(list) && list.length > 0, 'no hostile inputs to check');
  const ids = new Set(list.map(shape => shape.id));
  const unknown = allow.filter(id => !ids.has(id));
  assert.deepEqual(unknown, [], 'allowed exceptions that are not cases in this run');
  const accepted = list.filter(shape => accepts(shape.text, shape)).map(shape => shape.id);
  assert.deepEqual(accepted.filter(id => !allow.includes(id)), [], 'hostile inputs the reader accepted');
  assert.deepEqual(allow.filter(id => !accepted.includes(id)), [], 'allowed exceptions the reader now refuses (remove them from the list)');
}

module.exports = Object.freeze({
  FAMILIES,
  SYNTAXES,
  BREAKS,
  shapes,
  cases,
  variants,
  indent,
  timing,
  expectDefaultDeny,
  pointsOf,
});
