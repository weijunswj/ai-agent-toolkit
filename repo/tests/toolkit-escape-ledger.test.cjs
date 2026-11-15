'use strict';

// The escape list (repo/scripts/toolkit-escape-ledger.cjs): one line per bug found after merge,
// kept in the private evidence store at state/<owner>/<repo>/escapes.jsonl.
//   E2-a  add writes one valid line; a second add with the same id is refused.
//   E2-b  a missing field, a bad kind, an unknown key, a wrong type, over-long text, a local path,
//         a secret-shaped value or personal data is refused, and so is every hostile input shape
//         (support/hostile-inputs.cjs); refusals never repeat the refused text.
//   E2-c  group counts escapes by kind and lists the ones with no test yet; its output holds no
//         what_broke or why_missed text.
//   fix   fills fix_pr and test once, never overwriting them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const hostile = require('./support/hostile-inputs.cjs');
const ledger = require('../scripts/toolkit-escape-ledger.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-escape-ledger.cjs');
const REPO = 'weijunswj/ai-agent-toolkit';
const TODAY = '2026-11-15';
const today = () => TODAY;

const BROKE = 'The hourly sweep re-rendered the page but never wrote closes into state';
const MISSED = 'Tests used a fake page writer and never checked the stored state documents';

function entry(overrides = {}) {
  return {
    id: 'graph-state-never-written',
    date: '2026-11-05',
    kind: 'integration',
    found_by: 'owner',
    what_broke: BROKE,
    why_missed: MISSED,
    fix_pr: null,
    test: null,
    ...overrides,
  };
}

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ledgerFile = dir => path.join(dir, 'state', 'weijunswj', 'ai-agent-toolkit', 'escapes.jsonl');
const book = () => new ledger.EscapeLedger({ today });
const line = overrides => `${ledger.canonicalLine(entry(overrides))}\n`;
// The rules and fields a ledger text is refused under.
const refusedRules = text => ledger.readLedger(Buffer.from(text, 'utf8')).errors.flatMap(error => [error.rule, error.field]).filter(Boolean);

function cli(args) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

// A secret-shaped value assembled at runtime, so this source holds none.
const fakeToken = () => ['gh', 'p_', 'Q7wK2mZ9xL4vB8nR1tY6uI3oP5aS0dF2gH4jK6lZ'.slice(0, 36)].join('');
// A provider key shape (upper case and digits only) that only the shared provider formats name.
const fakeProviderKey = () => ['AK', 'IA', 'Q7WK2MZ7XL4VB6NR'].join('');
const fakeEmail = () => ['reader.one', ['mailbox', 'sg'].join('.')].join(String.fromCodePoint(0x40));

test('E2-a: add writes one canonical line that check accepts', t => {
  const dir = store(t);
  const result = book().add(dir, REPO, entry());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const text = fs.readFileSync(ledgerFile(dir), 'utf8');
  assert.equal(text, line());
  assert.deepEqual(JSON.parse(text), { schema: ledger.SCHEMA, ...entry() });
  const checked = book().check(dir, REPO);
  assert.equal(checked.ok, true);
  assert.equal(checked.entries.length, 1);
});

test('E2-a: a second add with the same id is refused and the file is unchanged', t => {
  const dir = store(t);
  assert.equal(book().add(dir, REPO, entry()).ok, true);
  const before = fs.readFileSync(ledgerFile(dir));
  const again = book().add(dir, REPO, entry({ what_broke: 'Another description of the same escape here' }));
  assert.equal(again.ok, false);
  assert.deepEqual(again.errors.map(error => error.rule), ['duplicate-id']);
  assert.deepEqual(fs.readFileSync(ledgerFile(dir)), before);
  assert.equal(book().add(dir, REPO, entry({ id: 'footer-sweep-other-repos' })).ok, true);
  assert.equal(book().check(dir, REPO).entries.length, 2);
});

test('E2-a: the CLI adds, checks and refuses a duplicate with exit 1', t => {
  const dir = store(t);
  const args = ['add', '--store', dir, '--repo', REPO, '--id', 'fetch-races', '--date', '2026-11-05', '--kind', 'integration',
    '--found-by', 'g2', '--what-broke', BROKE, '--why-missed', MISSED, '--fix-pr', '763', '--test', 'repo/tests/toolkit-local-bridge.test.cjs'];
  const first = cli(args);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /Added escape fetch-races/);
  assert.match(first.out, /push/);
  const second = cli(args);
  assert.equal(second.code, 1);
  assert.match(second.err, /duplicate-id/);
  const checked = cli(['check', '--store', dir, '--repo', REPO]);
  assert.equal(checked.code, 0, checked.err);
  assert.match(checked.out, /1 escape/);
});

test('E2-b: a missing field, bad kind or found_by, unknown key or wrong type is refused', () => {
  const omit = key => { const value = { schema: ledger.SCHEMA, ...entry() }; delete value[key]; return `${JSON.stringify(value)}\n`; };
  const extra = `${JSON.stringify({ schema: ledger.SCHEMA, ...entry(), note: 'x' })}\n`;
  const cases = {
    'missing why_missed': [omit('why_missed'), 'missing-key'],
    'missing schema': [omit('schema'), 'missing-key'],
    'unknown key': [extra, 'unknown-key'],
    'bad kind': [line().replace('"integration"', '"smoke"'), 'kind'],
    'bad found_by': [line().replace('"owner"', '"someone"'), 'found_by'],
    'fix_pr as text': [line().replace('"fix_pr":null', '"fix_pr":"763"'), 'fix_pr'],
    'fix_pr zero': [line().replace('"fix_pr":null', '"fix_pr":0'), 'fix_pr'],
    'fix_pr fraction': [line().replace('"fix_pr":null', '"fix_pr":7.5'), 'fix_pr'],
    'test as number': [line().replace('"test":null', '"test":5'), 'test'],
    'test outside the repository': [line().replace('"test":null', '"test":"../x.test.cjs"'), 'test'],
    'test absolute': [line().replace('"test":null', '"test":"/repo/tests/x.test.cjs"'), 'test'],
    'date not real': [line().replace('2026-11-05', '2026-02-30'), 'date'],
    'date in the future': [line().replace('2026-11-05', '2026-11-16'), 'date'],
    'id with spaces': [line().replace('"graph-state-never-written"', '"graph state"'), 'id'],
    'array line': ['[]\n', 'not-object'],
    'wrong schema': [line().replace(ledger.SCHEMA, 'toolkit.escape.v2'), 'schema'],
  };
  for (const [name, [text, rule]] of Object.entries(cases)) {
    assert.ok(refusedRules(text).includes(rule), `${name}: ${refusedRules(text).join(', ')}`);
  }
  assert.deepEqual(book().add('/nonexistent', REPO, { ...entry(), why_missed: undefined }).ok, false);
});

test('E2-b: over-long or too-short text is refused', () => {
  assert.ok(refusedRules(line({ what_broke: 'a'.repeat(ledger.MAX_TEXT + 1) })).includes('what_broke'));
  assert.ok(refusedRules(line({ why_missed: 'too short' })).includes('why_missed'));
  assert.ok(refusedRules(line({ id: 'a'.repeat(65) })).includes('id'));
  assert.deepEqual(refusedRules(line({ what_broke: 'a'.repeat(ledger.MAX_TEXT) })), []);
});

test('E2-b: a local path, secret-shaped value or personal data is refused without echoing it', t => {
  const bad = {
    'windows drive': 'The setup wrote into C:/Users/someone/AppData and broke the hook',
    'backslash path': 'The setup wrote into the profile folder under AppData\\Roaming for good',
    'unix home': 'The bridge read /home/someone/.claude/settings.json on every start',
    'mac home': 'The bridge read /Users/someone/Library/settings.json on every start',
    'temp folder': 'The test left scratch in /tmp/escape-run-1 after every single run',
    'project mount': 'The thread wrote the report to /mnt/project-files/838/report.md',
    'tilde home': 'The bridge read ~/.claude/settings.json on every single start',
    'powershell env': 'The command used $env:USERPROFILE instead of the documented folder',
    'cmd env': 'The command used %USERPROFILE% instead of the documented folder path',
    'secret token': `The sweep logged ${fakeToken()} into the shared run report file`,
    'provider key': `The sweep logged ${fakeProviderKey()} into the shared run report file`,
    'long mixed token': 'The sweep logged aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5 into the run file',
    'email address': `The sweep posted ${fakeEmail()} into a public issue comment`,
  };
  for (const [name, text] of Object.entries(bad)) {
    const errors = ledger.readLedger(Buffer.from(line({ what_broke: text }))).errors;
    assert.ok(errors.some(error => error.field === 'what_broke'), `${name} accepted`);
    const shown = errors.map(ledger.formatError).join('\n');
    assert.ok(!shown.includes(text.slice(10, 40)), `${name} echoed`);
  }
  // A short commit hash, a lower-case full hash, a URL and a slash command are fine.
  for (const text of ['Merged at 625355e but the page kept the old order', 'Full head 625355e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6 was not the reviewed one',
    'The link https://github.com/weijunswj/ai-agent-toolkit/pull/763 lost its anchor', 'Typing /loop in a thread started the wrong command']) {
    assert.deepEqual(ledger.readLedger(Buffer.from(line({ what_broke: text }))).errors, [], text);
  }
  const dir = store(t);
  const run = cli(['add', '--store', dir, '--repo', REPO, '--id', 'leaky', '--kind', 'unit', '--found-by', 'owner',
    '--what-broke', bad['secret token'], '--why-missed', MISSED]);
  assert.equal(run.code, 1);
  assert.ok(!`${run.out}${run.err}`.includes(fakeToken()), 'CLI echoed the token');
  assert.equal(fs.existsSync(ledgerFile(dir)), false);
});

test('E2-b: every hostile input shape is refused as a whole ledger', () => {
  hostile.expectDefaultDeny(assert, text => ledger.readLedger(Buffer.from(text, 'utf8')).ok, hostile.shapes);
  for (const shape of hostile.shapes.filter(item => item.bytes)) {
    assert.equal(ledger.readLedger(shape.bytes).ok, false, shape.id);
  }
});

test('E2-b: hostile shapes with any character outside printable ASCII are refused inside a text field', () => {
  const unusual = hostile.shapes.filter(shape => shape.points.length > 0 || /\n/.test(shape.text));
  hostile.expectDefaultDeny(assert, text => ledger.readLedger(Buffer.from(line({ what_broke: `Broke: ${text} in the run`.slice(0, ledger.MAX_TEXT) }))).ok, unusual);
});

test('E2-b: a ledger whose line ends are all CRLF is read; every other line-break and byte-order-mark variant is refused', () => {
  const valid = line() + line({ id: 'second-escape' });
  assert.equal(ledger.readLedger(Buffer.from(valid)).ok, true);
  const changed = hostile.variants(valid).filter(variant => variant.text !== valid);
  assert.ok(changed.length >= 6);
  const crlf = ledger.readLedger(Buffer.from(changed.find(variant => variant.id === 'crlf').text, 'utf8'));
  assert.equal(crlf.ok, true, JSON.stringify(crlf.errors));
  assert.deepEqual(crlf.entries.map(item => item.id), ['graph-state-never-written', 'second-escape']);
  for (const variant of changed.filter(item => item.id !== 'crlf')) assert.equal(ledger.readLedger(Buffer.from(variant.text, 'utf8')).ok, false, variant.id);
  // The whole-file check names the first line holding a character outside printable ASCII.
  assert.deepEqual(ledger.readLedger(Buffer.from(changed.find(variant => variant.id === 'bom').text, 'utf8')).errors, [{ line: 1, field: null, rule: 'not-printable-ascii' }]);
});

test('E2-b: mixed or lone-CR line ends are refused with a plain reason', () => {
  const cases = {
    'CRLF then LF': `${line().replace('\n', '\r\n')}${line({ id: 'second-escape' })}`,
    'LF then CRLF': `${line()}${line({ id: 'second-escape' }).replace('\n', '\r\n')}`,
    'lone CR line end': line().replace('\n', '\r'),
    'CR inside CRLF lines': `${line().replace('\n', '\r\r\n')}`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const read = ledger.readLedger(Buffer.from(text, 'utf8'));
    assert.equal(read.ok, false, name);
    assert.deepEqual(read.errors.map(error => error.rule), ['mixed-line-ends'], name);
    assert.match(ledger.formatError(read.errors[0]), /mixed-line-ends: .*LF.*CRLF/, name);
  }
});

test('E2-b: a store cloned with core.autocrlf=true reads, groups and takes new lines', t => {
  const git = (cwd, ...args) => {
    const run = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'user.name=Escape Test', '-c', 'user.email=escape-test@example.invalid', ...args], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout;
  };
  const root = store(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  git(source, 'init', '-q');
  assert.equal(book().add(source, REPO, entry()).ok, true);
  assert.equal(book().add(source, REPO, entry({ id: 'second-escape', kind: 'ci' })).ok, true);
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'seed');
  const clone = path.join(root, 'clone');
  const cloned = spawnSync('git', ['clone', '-q', '-c', 'core.autocrlf=true', source, clone], { encoding: 'utf8' });
  assert.equal(cloned.status, 0, cloned.stderr);
  // The checkout really has CRLF line ends, so the reads below go through the CRLF path.
  assert.match(fs.readFileSync(ledgerFile(clone), 'utf8'), /\r\n.*\r\n$/s);
  const checked = book().check(clone, REPO);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(checked.entries.length, 2);
  assert.equal(book().group(clone, REPO).summary.total, 2);
  assert.equal(book().add(clone, REPO, entry({ id: 'third-escape' })).ok, true);
  assert.equal(book().fix(clone, REPO, 'second-escape', { fix_pr: 12 }).ok, true);
  // Writes are LF; the file stays one kind of line end and reads back.
  assert.doesNotMatch(fs.readFileSync(ledgerFile(clone), 'utf8'), /\r/);
  assert.equal(book().check(clone, REPO).entries.length, 3);
});

test('E2-b: non-canonical JSON is refused: spacing, key order, duplicate keys and escapes', () => {
  const value = { schema: ledger.SCHEMA, ...entry() };
  const spaced = `${JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ')}\n`;
  const reordered = `${JSON.stringify({ id: value.id, schema: value.schema, ...value })}\n`;
  const duplicate = line().replace('{"schema"', '{"id":"other-id","schema"');
  const escaped = line().replace('"kind":"integration"', '"kind":"\\u0069ntegration"');
  for (const [name, text] of Object.entries({ spaced, reordered, duplicate, escaped })) {
    assert.ok(refusedRules(text).includes('not-canonical') || refusedRules(text).length > 0, name);
    assert.equal(ledger.readLedger(Buffer.from(text)).ok, false, name);
  }
  assert.ok(refusedRules('').length === 0, 'an empty ledger is valid');
  assert.ok(refusedRules(line().slice(0, -1)).includes('no-final-newline'));
  assert.ok(refusedRules(`${line()}\n${line({ id: 'next-one' })}`).includes('blank-line'));
  assert.deepEqual(ledger.readLedger(Buffer.from(line() + line())).errors, [{ line: 2, field: 'id', rule: 'duplicate-id' }]);
});

test('E2-b: the reader stays linear on large input and refuses an oversized ledger', () => {
  const build = size => `${line({ what_broke: `x${'y'.repeat(Math.max(12, size))}` })}`;
  const timed = hostile.timing(text => ledger.readLedger(Buffer.from(text)), build, { maxSize: 1 << 19 });
  assert.ok(timed.ok, timed.message);
  const big = Buffer.alloc(ledger.MAX_FILE_BYTES + 1, 0x61);
  assert.ok(ledger.readLedger(big).errors.some(error => error.rule === 'too-large'));
  assert.equal(ledger.readLedger(Buffer.from(line())).ok, true);
});

test('E2-b: a bad repository name or a symlinked ledger is refused', t => {
  for (const repo of ['weijunswj', 'a/b/c', '../x/y', 'owner/..', 'own er/x', '']) {
    assert.throws(() => ledger.ledgerPath('/store', repo), /repository/, repo);
  }
  assert.equal(ledger.ledgerPath('/store', 'weijunswj/ai-agent-toolkit'), path.join('/store', 'state', 'weijunswj', 'ai-agent-toolkit', 'escapes.jsonl'));
  const dir = store(t);
  const outside = path.join(dir, 'outside.jsonl');
  fs.writeFileSync(outside, line());
  fs.mkdirSync(path.dirname(ledgerFile(dir)), { recursive: true });
  try { fs.symlinkSync(outside, ledgerFile(dir)); } catch { t.skip('symlinks need extra rights on this system'); return; }
  assert.equal(book().check(dir, REPO).ok, false);
  assert.equal(book().add(dir, REPO, entry({ id: 'via-link' })).ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), line());
});

test('E2-c: group counts by kind and lists escapes with no test, with no ledger text', t => {
  const dir = store(t);
  const add = overrides => assert.equal(book().add(dir, REPO, entry(overrides)).ok, true);
  add({ id: 'graph-state', kind: 'end-to-end' });
  add({ id: 'footer-sweep', kind: 'end-to-end', what_broke: 'Footer sweep skipped repositories added after an update' });
  add({ id: 'fetch-races', kind: 'integration', fix_pr: 763, test: 'repo/tests/toolkit-local-bridge.test.cjs' });
  add({ id: 'set-env-misroute', kind: 'rules', why_missed: 'No routing test fed the exact phrase the owner typed' });
  const grouped = book().group(dir, REPO);
  assert.equal(grouped.ok, true);
  assert.equal(grouped.summary.total, 4);
  assert.deepEqual(grouped.summary.by_kind, { unit: 0, integration: 1, 'end-to-end': 2, ci: 0, install: 0, rules: 1 });
  assert.deepEqual(grouped.summary.untested, ['footer-sweep', 'graph-state', 'set-env-misroute']);
  for (const args of [[], ['--json']]) {
    const run = cli(['group', '--store', dir, '--repo', REPO, ...args]);
    assert.equal(run.code, 0, run.err);
    for (const text of [BROKE, MISSED, 'Footer sweep skipped', 'No routing test fed']) {
      assert.ok(!run.out.includes(text.slice(0, 20)), `group output holds ledger text: ${text}`);
    }
    if (args.length) assert.deepEqual(JSON.parse(run.out), { schema: ledger.GROUP_SCHEMA, repo: REPO, ...grouped.summary });
    else assert.match(run.out, /4 escapes[\s\S]*end-to-end 2[\s\S]*No test yet \(3\): footer-sweep, graph-state, set-env-misroute/);
  }
});

test('E2-c: a repository with no escape list groups as zero, and a broken one is refused', t => {
  const dir = store(t);
  const empty = book().group(dir, REPO);
  assert.equal(empty.ok, true);
  assert.equal(empty.summary.total, 0);
  fs.mkdirSync(path.dirname(ledgerFile(dir)), { recursive: true });
  fs.writeFileSync(ledgerFile(dir), `${line()}not json\n`);
  const broken = cli(['group', '--store', dir, '--repo', REPO]);
  assert.equal(broken.code, 1);
  assert.match(broken.err, /line 2: not-json/);
  assert.equal(cli(['group', '--store', path.join(dir, 'missing'), '--repo', REPO]).code, 1);
});

test('fix: fills fix_pr and test once and never overwrites them', t => {
  const dir = store(t);
  assert.equal(book().add(dir, REPO, entry()).ok, true);
  assert.equal(book().add(dir, REPO, entry({ id: 'other-escape' })).ok, true);
  assert.equal(book().fix(dir, REPO, 'graph-state-never-written', { fix_pr: 1120 }).ok, true);
  assert.equal(book().fix(dir, REPO, 'graph-state-never-written', { test: 'repo/tests/x.test.cjs' }).ok, true);
  const after = book().check(dir, REPO).entries;
  assert.deepEqual(after[0], { ...entry(), fix_pr: 1120, test: 'repo/tests/x.test.cjs' });
  assert.deepEqual(after[1], entry({ id: 'other-escape' }));
  const before = fs.readFileSync(ledgerFile(dir));
  assert.deepEqual(book().fix(dir, REPO, 'graph-state-never-written', { fix_pr: 1 }).errors.map(error => error.rule), ['already-set']);
  assert.deepEqual(book().fix(dir, REPO, 'no-such-escape', { fix_pr: 1 }).errors.map(error => error.rule), ['unknown-id']);
  assert.ok(book().fix(dir, REPO, 'other-escape', { test: '/abs/path.test.cjs' }).errors.some(error => error.field === 'test'));
  assert.deepEqual(fs.readFileSync(ledgerFile(dir)), before);
  const run = cli(['fix', '--store', dir, '--repo', REPO, '--id', 'other-escape', '--fix-pr', '42']);
  assert.equal(run.code, 0, run.err);
});

test('the CLI refuses unknown commands, unknown or repeated flags and missing values', () => {
  assert.equal(cli([]).code, 2);
  assert.equal(cli(['remove', '--store', '.', '--repo', REPO]).code, 2);
  assert.equal(cli(['check', '--store', '.', '--repo', REPO, '--bogus', 'x']).code, 2);
  assert.equal(cli(['check', '--store', '.', '--store', '.', '--repo', REPO]).code, 2);
  assert.equal(cli(['check', '--store', '.', '--repo']).code, 2);
  assert.equal(cli(['add', '--store', '.', '--repo', REPO, '--fix-pr', 'abc']).code, 2);
  assert.match(cli(['--help']).out, /Usage/);
});
