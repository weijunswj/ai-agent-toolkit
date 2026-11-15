'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { auditDecisionTraces, traceEntries, indexErrorText, commentSummary, ledgerTopics, repairedBody, parseArgs, INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER, MAX_INDEX_COMMENTS, INDEX_BEGIN, INDEX_END } = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');

const person = (id, body) => ({ id, user: { login: 'owner', type: 'User' }, body });
const generated = (id, body) => person(id, `${INDEX_COMMENT_MARKER}\n<!-- programme-trace intent=test part=1/1 -->\n${body}`);
const PREFIX = 'INT-TK421-';

for (const row of [
  { name: 'old one-hop index', root: 2, indexes: [person(2, `${INDEX_COMMENT_MARKER}\n[x](#issuecomment-1)`)] },
  { name: 'directory and topic index', root: 3, indexes: [person(2, `${INDEX_COMMENT_MARKER}\n[x](#issuecomment-1)`), person(3, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n- **Topic:** [list 1](#issuecomment-2)`)] },
  { name: 'missing directory page', root: 3, indexes: [], code: 'INDEX_MISSING' },
  { name: 'missing topic page', root: 3, indexes: [person(3, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n[list 1](#issuecomment-2)`)], code: 'INDEX_MISSING' },
  { name: 'missing decision', root: 2, indexes: [generated(2, '[x](#issuecomment-999)')], code: 'INDEX_MISSING' },
  { name: 'cycle', root: 2, indexes: [generated(2, '[list 1](#issuecomment-3)'), generated(3, '[list 1](#issuecomment-2)')], code: 'INDEX_CYCLE' },
  { name: 'unrelated issue link', root: 2, indexes: [generated(2, '[x](https://github.com/example.test/project/issues/99#issuecomment-1)')], code: 'INDEX_UNRELATED' },
  { name: 'unrelated repository link', root: 2, indexes: [generated(2, '[x](https://github.com/other.test/project/issues/7#issuecomment-1)')], code: 'INDEX_UNRELATED' },
  { name: 'unrelated protocol-relative link', root: 2, indexes: [generated(2, '[x](//github.com/other.test/project/issues/7#issuecomment-1)')], code: 'INDEX_UNRELATED' },
  { name: 'unrelated upper-case scheme link', root: 2, indexes: [generated(2, '[x](HTTPS://github.com/other.test/project/issues/7#issuecomment-1)')], code: 'INDEX_UNRELATED' },
  { name: 'repository case variant', root: 2, indexes: [generated(2, '[x](https://github.com/Example.test/Project/issues/7#issuecomment-1)')] },
  { name: 'directory links decision comment', root: 2, indexes: [person(2, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n- **Topic:** [1](#issuecomment-1)`)] },
  { name: 'directory links another directory', root: 3, indexes: [person(2, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n[decision](#issuecomment-1)`), person(3, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n[list 1](#issuecomment-2)`)], code: 'INDEX_UNRELATED', directories: ['2', '3'] },
  { name: 'too many hops', root: 4, indexes: [generated(2, '[x](#issuecomment-1)'), generated(3, '[list 1](#issuecomment-2)'), generated(4, '[list 1](#issuecomment-3)')], code: 'INDEX_DEPTH' },
]) test(`index traversal: ${row.name}`, () => {
  const comments = [person(1, 'Topic\n---\nINT-TK421-001 decision'), ...row.indexes];
  const options = { body: `[topic directory 1](#issuecomment-${row.root})`, comments, recordPrefix: PREFIX, repository: 'example.test/project', issue: 7 };
  const result = auditDecisionTraces(options);
  assert.equal(result.ok, !row.code);
  if (row.code) assert.ok(result.index_errors.some(error => error.code === row.code), JSON.stringify(result));
  else {
    assert.deepEqual(result.index_errors, []);
    assert.deepEqual(result.unlinked_decisions, []);
  }
  // Projection stops only on structural faults. A dead or foreign link covers nothing, so the
  // decision returns to the body trace and the page keeps redrawing.
  if (row.indexes.length && ['INDEX_CYCLE', 'INDEX_DEPTH'].includes(row.code)) assert.throws(() => traceEntries(comments, PREFIX, options.repository, options.issue), { code: 'TRACE_INDEX_INVALID', message: /edit or delete the named index comment/ });
  else if (row.code) {
    const trace = traceEntries(comments, PREFIX, options.repository, options.issue);
    if (row.directories) {
      assert.deepEqual(trace.directories.map(entry => entry.id), row.directories, 'the inner directory returns as a body root');
      const projected = auditDecisionTraces({ ...options, body: trace.directories.map(entry => `[topic directory 1](#issuecomment-${entry.id})`).join('\n') });
      assert.deepEqual(projected.unlinked_decisions, [], 'the decision under the inner directory stays reachable');
      assert.ok(projected.index_errors.some(error => error.code === row.code), 'the audit still reports the hand-nested link');
    } else assert.ok(trace.entries.some(entry => entry.id === '1'), JSON.stringify(trace));
    assert.match(require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs').indexErrorText(result.index_errors), /remove that link from the named index comment/);
  }
});

test('index traversal has a page-count bound and cannot use foreign body links for reachability', () => {
  const indexes = Array.from({ length: MAX_INDEX_COMMENTS + 1 }, (_, n) => generated(n + 2, '[x](#issuecomment-1)'));
  const result = auditDecisionTraces({ body: indexes.map(comment => `[list 1](#issuecomment-${comment.id})`).join('\n'), comments: [person(1, 'Topic\n---\nDecision'), ...indexes] });
  assert.equal(result.ok, false);
  assert.ok(result.index_errors.some(error => error.code === 'INDEX_LIMIT'));
  assert.match(indexErrorText(result.index_errors), /Too many generated index pages/);
  assert.doesNotMatch(indexErrorText(result.index_errors), /loop or too deep/);
  assert.throws(() => traceEntries([person(1, 'Topic\n---\nDecision'), ...indexes]), { code: 'TRACE_INDEX_INVALID', message: /compact or delete obsolete index comments/ });
  const foreign = auditDecisionTraces({ body: '[x](https://github.com/other.test/project/issues/7#issuecomment-1)', comments: [person(1, 'Topic\n---\nDecision')], repository: 'example.test/project', issue: 7 });
  assert.equal(foreign.ok, false);
  assert.deepEqual(foreign.unlinked_decisions.map(entry => entry.id), ['1']);
});

for (const row of [
  { code: 'INDEX_MISSING', reason: /A linked comment/, recovery: /remove that link/ },
  { code: 'INDEX_UNRELATED', reason: /A linked comment/, recovery: /remove that link/ },
  { code: 'INDEX_CYCLE', reason: /An index comment links in a loop/, recovery: /edit or delete the named index comment/ },
  { code: 'INDEX_DEPTH', reason: /An index comment links.*too deep/, recovery: /edit or delete the named index comment/ },
  { code: 'INDEX_LIMIT', reason: /Too many generated index pages/, recovery: /compact or delete obsolete index comments/ },
]) test(`index recovery text: ${row.code}`, () => {
  const text = indexErrorText([{ code: row.code, id: '12', target: '13' }]);
  assert.match(text, row.reason);
  assert.match(text, row.recovery);
  assert.doesNotMatch(text, /\. [a-z]/, 'sentences start with capitals');
});

test('a shared index reached along a longer path still enforces the depth bound', () => {
  const comments = [person(1, 'Topic\n---\nDecision'),
    generated(2, '[x](#issuecomment-1)'),
    generated(3, '[list 1](#issuecomment-2)'),
    generated(4, '[list 1](#issuecomment-3)')];
  const result = auditDecisionTraces({ body: '[list 1](#issuecomment-3) [list 2](#issuecomment-4)', comments });
  assert.equal(result.ok, false);
  assert.ok(result.index_errors.some(error => error.code === 'INDEX_DEPTH'));
});

for (const reference of ['[other issue](https://github.com/example.test/project/issues/99#issuecomment-999)', '[missing](#issuecomment-999)', '[self](#issuecomment-2)']) {
  test(`hand-made index keeps base handling of ${reference}`, () => {
    const comments = [person(1, 'Topic\n---\nINT-TK421-001 Decision'), person(2, `${INDEX_COMMENT_MARKER}\n## Decision index for the task (moved from the issue body)\n[local](#issuecomment-1)\n${reference}`)];
    const result = auditDecisionTraces({ body: '[list 1](#issuecomment-2)', comments, repository: 'example.test/project', issue: 7, recordPrefix: PREFIX });
    assert.equal(result.ok, true);
    assert.deepEqual(result.index_errors, []);
    assert.doesNotThrow(() => traceEntries(comments, PREFIX, 'example.test/project', 7));
  });
}

test('legacy index-to-index references are not traversed, preserving base unlinked-decision findings', () => {
  const comments = [person(1, 'Topic\n---\nINT-TK421-001 Decision'), person(2, `${INDEX_COMMENT_MARKER}\n[index](#issuecomment-3)`), person(3, `${INDEX_COMMENT_MARKER}\n[decision](#issuecomment-1)\n[index](#issuecomment-2)`)];
  const result = auditDecisionTraces({ body: '[list 1](#issuecomment-2)', comments, recordPrefix: PREFIX });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unlinked_decisions.map(entry => entry.id), ['1']);
  assert.deepEqual(result.index_errors, []);
  assert.equal(traceEntries(comments).indexes.length, 2, 'both legacy indexes stay root links, as on the base');
});

test('a foreign reference in a hand-made index cannot cover a local decision', () => {
  const comments = [person(1, 'Topic\n---\nDecision'), person(2, `${INDEX_COMMENT_MARKER}\n[foreign](https://github.com/example.test/project/issues/99#issuecomment-1)`)];
  const options = { body: '[list 1](#issuecomment-2)', comments, repository: 'example.test/project', issue: 7 };
  const result = auditDecisionTraces(options);
  assert.equal(result.ok, false);
  assert.deepEqual(result.index_errors, []);
  assert.deepEqual(result.unlinked_decisions.map(entry => entry.id), ['1']);
  assert.deepEqual(traceEntries(comments, null, options.repository, options.issue).entries.map(entry => entry.id), ['1']);
});

test('the CLI resolves gh to a full path and hides its window for both read-only requests', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs'), 'utf8');
  const calls = [];
  const resolved = path.resolve(__dirname, 'fake-gh.exe');
  const context = {
    module: {}, process: { argv: ['node', 'audit', '--repo', 'acme/app', '--issue', '7'], stdout: { write() {} } },
    require(name) {
      if (name === './resolve-executable.cjs') return { resolveExecutable(executable) { assert.equal(executable, 'gh'); return resolved; } };
      if (name === './decision-tags.cjs') return require('../../skills/github-program-reconciler/scripts/decision-tags.cjs');
      if (name === 'node:child_process') return { spawnSync(executable, args, options) {
        calls.push({ executable, args, options });
        return { status: 0, stdout: args.some(arg => arg.includes('/comments?')) ? '[]' : '{"body":""}' };
      } };
      return require(name);
    },
  };
  context.require.main = context.module;
  vm.runInNewContext(source, context);
  assert.equal(context.process.exitCode, 0);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.executable, resolved);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.args[0], 'api');
    assert.equal(call.args.includes('--method'), false);
  }
});

// Runs the CLI against a stub gh that serves the given comment pages in order; returns the gh calls and output.
function runPagedCli(pages) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs'), 'utf8');
  const calls = [];
  const out = [];
  const context = {
    module: {}, process: { argv: ['node', 'audit', '--repo', 'acme/app', '--issue', '7'], stdout: { write(text) { out.push(text); } } },
    console: { error(text) { out.push(String(text)); }, log(text) { out.push(String(text)); } },
    require(name) {
      if (name === './resolve-executable.cjs') return { resolveExecutable() { return 'gh'; } };
      if (name === './decision-tags.cjs') return require('../../skills/github-program-reconciler/scripts/decision-tags.cjs');
      if (name === 'node:child_process') return { spawnSync(executable, args) {
        calls.push(args);
        const match = args.find(arg => arg.includes('/comments?'))?.match(/[?&]page=(\d+)/);
        if (!match) return { status: 0, stdout: '{"body":""}' };
        const page = pages[Number(match[1]) - 1];
        return { status: 0, stdout: typeof page === 'string' ? page : JSON.stringify(page || []) };
      } };
      return require(name);
    },
  };
  context.require.main = context.module;
  vm.runInNewContext(source, context);
  return { calls, exitCode: context.process.exitCode, output: out.join('') };
}

test('the CLI reads comments in numbered pages until a short page, never with --paginate', () => {
  const full = Array.from({ length: 100 }, (_, index) => person(index + 1, 'Note'));
  const { calls, exitCode, output } = runPagedCli([full, [person(101, 'Note')]]);
  assert.equal(exitCode, 0);
  const pages = calls.map(args => args.find(arg => arg.includes('/comments?'))).filter(Boolean);
  assert.deepEqual(pages, ['repos/acme/app/issues/7/comments?per_page=100&page=1', 'repos/acme/app/issues/7/comments?per_page=100&page=2']);
  assert.equal(calls.some(args => args.includes('--paginate')), false);
  assert.equal(JSON.parse(output).comments, 101);
});

test('the CLI refuses a comment page that is not a list', () => {
  const { exitCode, output } = runPagedCli(['{"message":"Not Found"}']);
  assert.notEqual(exitCode, 0);
  assert.match(output, /comment page 1 of #7 was not a list/);
});

test('loading the audit before programme state preserves the shared body threshold', () => {
  const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const reconciler = new state.Reconciler({});
  assert.equal(reconciler.threshold, 60000);
});

test('the real audit CLI without gh fails without a circular dependency warning', () => {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.PATH = '';
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs'), '--repo', 'o/r', '--issue', '1'], {
    env: environment, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /gh was not found on PATH/);
  assert.doesNotMatch(result.stderr, /circular dependency/i);
  assert.match(result.stderr.trim(), /^FAIL: gh was not found on PATH\. Install it or add its folder to PATH\.$/);
});

test('every decision comment must be reachable from the body, directly or through a linked index comment', () => {
  const comments = [
    person(1, 'INT-TK421-001 decision'),
    person(2, `${INDEX_COMMENT_MARKER}\n- [INT-TK421-003](#issuecomment-3)`),
    person(3, 'INT-TK421-003 later'),
    person(4, 'INT-TK421-004 SUPERSEDES=INT-TK421-001'),
    { id: 5, user: { login: 'ci[bot]', type: 'Bot' }, body: 'bot noise' },
  ];
  const body = 'Index: [one](#issuecomment-1) [older](#issuecomment-2)';
  const result = auditDecisionTraces({ body, comments, recordPrefix: PREFIX });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unlinked, [{ id: '4', record: 'INT-TK421-004', index: false, tag: null, tag_label: null, date: null, summary: 'INT-TK421-004 SUPERSEDES=INT-TK421-001', supersedes: ['INT-TK421-001'], superseded_by: null, superseded_by_id: null }]);
  assert.deepEqual(result.superseded_unmarked, [{ id: '1', record: 'INT-TK421-001', superseded_by: 'INT-TK421-004' }], 'the replaced record is not marked yet');
  assert.deepEqual(result.index_comments, ['2']);
  assert.equal(result.comments, 4, 'bots are ignored');
  assert.deepEqual(result.unlabelled, []);

  const fixed = repairedBody(body, result.unlinked, result.superseded_unmarked);
  assert.ok(fixed.startsWith(body), 'existing text is kept');
  assert.ok(fixed.includes([
    INDEX_BEGIN,
    '- undated · INT-TK421-004 · [INT-TK421-004 SUPERSEDES=INT-TK421-001](#issuecomment-4) · SUPERSEDES=INT-TK421-001',
    '- superseded record · INT-TK421-001 · [INT-TK421-001](#issuecomment-1) · superseded by INT-TK421-004',
    INDEX_END,
  ].join('\n')));
  assert.equal(auditDecisionTraces({ body: fixed, comments, recordPrefix: PREFIX }).ok, true);
  assert.equal(repairedBody(fixed, [{ id: '9', record: null, index: false }]).split(INDEX_BEGIN).length, 2, 'lines join the existing index');

  // A comment that is neither tagged nor a record needs no index entry: listed, never a failure.
  const plain = [...comments, person(6, 'A progress note.')];
  const quiet = auditDecisionTraces({ body: fixed, comments: plain, recordPrefix: PREFIX });
  assert.equal(quiet.ok, true);
  assert.deepEqual(quiet.unlinked.map(entry => entry.id), ['6']);
  assert.deepEqual(quiet.unlinked_decisions, []);
  const tagged = auditDecisionTraces({ body: fixed, comments: [...comments, person(7, 'SCOPE-CONFIRMED\n---\nThe owner confirmed the scope.')], recordPrefix: PREFIX });
  assert.equal(tagged.ok, false, 'an unlinked tagged decision still fails');
  assert.deepEqual(tagged.unlinked_decisions.map(entry => entry.id), ['7']);

  // A record marked in its own comment needs no marking line.
  const marked = comments.map(comment => (comment.id === 1 ? person(1, 'INT-TK421-001 decision (superseded by INT-TK421-004)') : comment));
  assert.deepEqual(auditDecisionTraces({ body, comments: marked, recordPrefix: PREFIX }).superseded_unmarked, []);
});

test('index lines carry the date, record, summary, fragment link and supersession', () => {
  const comments = [
    { ...person(10, '## INT-TK421-010 - First decision\nDetails.'), created_at: '2026-10-01T00:00:00Z' },
    { ...person(11, 'INT-TK421-011 replaces it\nSUPERSEDES=INT-TK421-010'), created_at: '2026-10-02T00:00:00Z' },
    { ...person(12, 'Plain note with [a link](https://example.com) | and a pipe'), created_at: '2026-10-03T00:00:00Z' },
  ];
  const result = auditDecisionTraces({ body: '', comments, recordPrefix: PREFIX });
  const repaired = repairedBody('', result.unlinked, result.superseded_unmarked);
  assert.deepEqual(repaired.split('\n').filter(line => line.startsWith('- ')), [
    '- 2026-10-01 · INT-TK421-010 · [INT-TK421-010 - First decision](#issuecomment-10) · superseded by INT-TK421-011',
    '- 2026-10-02 · INT-TK421-011 · [INT-TK421-011 replaces it](#issuecomment-11) · SUPERSEDES=INT-TK421-010',
    '- 2026-10-03 · comment · [Plain note with a link and a pipe](#issuecomment-12)',
  ]);
  assert.equal(auditDecisionTraces({ body: repaired, comments, recordPrefix: PREFIX }).ok, true);

  // Topics from a decision ledger go after the link; a missing topic leaves the line as it was.
  const topics = ledgerTopics({ schema: 'toolkit.decision-ledger.v1', issues: [{ issue: 7, entries: [
    { comment_id: 10, topic: 'page-format' }, { comment_id: 12, topic: 'uat | [x]' }, { comment_id: 11, topic: '' },
  ] }] });
  assert.deepEqual(repairedBody('', result.unlinked, result.superseded_unmarked, topics).split('\n').filter(line => line.startsWith('- ')), [
    '- 2026-10-01 · INT-TK421-010 · [INT-TK421-010 - First decision](#issuecomment-10) · page-format · superseded by INT-TK421-011',
    '- 2026-10-02 · INT-TK421-011 · [INT-TK421-011 replaces it](#issuecomment-11) · SUPERSEDES=INT-TK421-010',
    '- 2026-10-03 · comment · [Plain note with a link and a pipe](#issuecomment-12) · uat x',
  ]);
  assert.throws(() => ledgerTopics({ schema: 'other', issues: [] }), /toolkit\.decision-ledger\.v1/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--ledger', 'l.json']), /only with --repair/);
  assert.equal(parseArgs(['--repo', 'o/r', '--issue', '7', '--repair', '--out', 'b.md', '--ledger', 'l.json']).ledger, 'l.json');
});

test('unknown SUPERSEDES targets and a body at the threshold fail', () => {
  const comments = [person(1, 'INT-TK421-001 SUPERSEDES=INT-TK421-999')];
  const linked = '[x](#issuecomment-1)';
  assert.deepEqual(auditDecisionTraces({ body: linked, comments, recordPrefix: PREFIX }).unknown_supersedes, [{ id: '1', supersedes: 'INT-TK421-999' }]);
  const prose = auditDecisionTraces({ body: linked, comments: [person(1, 'INT-TK421-001\nSUPERSEDES=the auto-refresh allowance')], recordPrefix: PREFIX });
  assert.deepEqual(prose.unknown_supersedes, [], 'prose after SUPERSEDES= is not a record reference');
  const sentence = auditDecisionTraces({ body: linked, comments: [person(1, 'INT-TK421-001 SUPERSEDES=INT-TK421-999.')], recordPrefix: PREFIX });
  assert.deepEqual(sentence.unknown_supersedes, [{ id: '1', supersedes: 'INT-TK421-999' }], 'a trailing full stop does not hide a record reference');
  for (const suffix of ['..', '-draft', '_x', ')']) {
    const suffixed = auditDecisionTraces({ body: linked, comments: [person(1, `INT-TK421-001 SUPERSEDES=INT-TK421-999${suffix}`)], recordPrefix: PREFIX });
    assert.deepEqual(suffixed.unknown_supersedes, [{ id: '1', supersedes: 'INT-TK421-999' }], `a "${suffix}" suffix does not hide a record reference`);
  }
  const known = auditDecisionTraces({ body: '[x](#issuecomment-1) [y](#issuecomment-2)', comments: [person(1, 'INT-TK421-001'), person(2, 'INT-TK421-002 SUPERSEDES=INT-TK421-001-draft.')], recordPrefix: PREFIX });
  assert.deepEqual(known.unknown_supersedes, [], 'a known record with a suffix is not reported');
  assert.equal(prose.ok, true);
  const long = auditDecisionTraces({ body: linked.padEnd(100, ' '), comments: [person(1, 'INT-TK421-001')], recordPrefix: PREFIX, threshold: 100 });
  assert.equal(long.over_threshold, true);
  assert.equal(long.ok, false);
});

test('arguments are validated before any GitHub read', () => {
  assert.deepEqual(parseArgs(['--repo', 'o/r', '--issue', '7']).threshold, 60000);
  assert.throws(() => parseArgs(['--repo', 'o/r']), /Usage/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--repair']), /--out/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--threshold', '0']), /positive/);
  // The record prefix is literal text; regular-expression syntax is refused, never compiled.
  assert.equal(parseArgs(['--repo', 'o/r', '--issue', '7', '--record-prefix', 'INT-TK421-']).recordPrefix, 'INT-TK421-');
  for (const prefix of ['(a+)+$', 'INT.*', '[0-9]{3}']) {
    assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--record-prefix', prefix]), /--record-prefix must be/, prefix);
    assert.throws(() => auditDecisionTraces({ body: '', comments: [], recordPrefix: prefix }), /--record-prefix must be/, prefix);
  }
  const mixed = auditDecisionTraces({ body: '[x](#issuecomment-1)', comments: [person(1, 'see INT-TK421-x then INT-TK421-007')], recordPrefix: PREFIX });
  assert.deepEqual(mixed.unlabelled, []);
});

test('an index summary never carries an HTML comment or tag opener', () => {
  assert.equal(commentSummary('<!-- record -->\nDecision: keep the table'), 'Decision: keep the table');
  assert.equal(commentSummary('<!-- spans\ntwo lines -->\nReal line'), 'Real line');
  assert.equal(commentSummary('<!-- never closed\nhides everything'), 'comment');
  assert.equal(commentSummary('<!<!---->-- trick'), '!-- trick');
  for (const text of ['a <!-- b', '<b>bold</b> text', 'x --!> y <!--']) assert.doesNotMatch(commentSummary(text), /[<>]/, text);
});
