'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { auditDecisionTraces, repairedBody, parseArgs, INDEX_COMMENT_MARKER, INDEX_BEGIN, INDEX_END } = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');

const person = (id, body) => ({ id, user: { login: 'owner', type: 'User' }, body });
const PREFIX = 'INT-TK421-';

test('the CLI resolves gh to a full path and hides its window for both read-only requests', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs'), 'utf8');
  const calls = [];
  const resolved = path.resolve(__dirname, 'fake-gh.exe');
  const context = {
    module: {}, process: { argv: ['node', 'audit', '--repo', 'acme/app', '--issue', '7'], stdout: { write() {} } },
    require(name) {
      if (name === './resolve-executable.cjs') return { resolveExecutable(executable) { assert.equal(executable, 'gh'); return resolved; } };
      if (name === 'node:child_process') return { spawnSync(executable, args, options) {
        calls.push({ executable, args, options });
        return { status: 0, stdout: args.includes('--paginate') ? '[[]]' : '{"body":""}' };
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

test('every non-bot comment must be reachable from the body, directly or through a linked index comment', () => {
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
  assert.deepEqual(result.unlinked, [{ id: '4', record: 'INT-TK421-004', index: false }]);
  assert.deepEqual(result.index_comments, ['2']);
  assert.equal(result.comments, 4, 'bots are ignored');
  assert.deepEqual(result.unlabelled, []);

  const fixed = repairedBody(body, result.unlinked);
  assert.ok(fixed.startsWith(body), 'existing text is kept');
  assert.ok(fixed.includes(`${INDEX_BEGIN}\n- [INT-TK421-004](#issuecomment-4)\n${INDEX_END}`));
  assert.equal(auditDecisionTraces({ body: fixed, comments, recordPrefix: PREFIX }).ok, true);
  assert.equal(repairedBody(fixed, [{ id: '9', record: null, index: false }]).split(INDEX_BEGIN).length, 2, 'lines join the existing index');
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
