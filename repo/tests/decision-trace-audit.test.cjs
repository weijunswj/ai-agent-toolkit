'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditDecisionTraces, repairedBody, parseArgs, INDEX_COMMENT_MARKER, INDEX_BEGIN, INDEX_END } = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');

const person = (id, body) => ({ id, user: { login: 'owner', type: 'User' }, body });
const PATTERN = 'INT-TK421-[0-9]{3}';

test('every non-bot comment must be reachable from the body, directly or through a linked index comment', () => {
  const comments = [
    person(1, 'INT-TK421-001 decision'),
    person(2, `${INDEX_COMMENT_MARKER}\n- [INT-TK421-003](#issuecomment-3)`),
    person(3, 'INT-TK421-003 later'),
    person(4, 'INT-TK421-004 SUPERSEDES=INT-TK421-001'),
    { id: 5, user: { login: 'ci[bot]', type: 'Bot' }, body: 'bot noise' },
  ];
  const body = 'Index: [one](#issuecomment-1) [older](#issuecomment-2)';
  const result = auditDecisionTraces({ body, comments, recordPattern: PATTERN });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unlinked, [{ id: '4', record: 'INT-TK421-004', index: false }]);
  assert.deepEqual(result.index_comments, ['2']);
  assert.equal(result.comments, 4, 'bots are ignored');
  assert.deepEqual(result.unlabelled, []);

  const fixed = repairedBody(body, result.unlinked);
  assert.ok(fixed.startsWith(body), 'existing text is kept');
  assert.ok(fixed.includes(`${INDEX_BEGIN}\n- [INT-TK421-004](#issuecomment-4)\n${INDEX_END}`));
  assert.equal(auditDecisionTraces({ body: fixed, comments, recordPattern: PATTERN }).ok, true);
  assert.equal(repairedBody(fixed, [{ id: '9', record: null, index: false }]).split(INDEX_BEGIN).length, 2, 'lines join the existing index');
});

test('unknown SUPERSEDES targets and a body at the threshold fail', () => {
  const comments = [person(1, 'INT-TK421-001 SUPERSEDES=INT-TK421-999')];
  const linked = '[x](#issuecomment-1)';
  assert.deepEqual(auditDecisionTraces({ body: linked, comments, recordPattern: PATTERN }).unknown_supersedes, [{ id: '1', supersedes: 'INT-TK421-999' }]);
  const long = auditDecisionTraces({ body: linked.padEnd(100, ' '), comments: [person(1, 'INT-TK421-001')], recordPattern: PATTERN, threshold: 100 });
  assert.equal(long.over_threshold, true);
  assert.equal(long.ok, false);
});

test('arguments are validated before any GitHub read', () => {
  assert.deepEqual(parseArgs(['--repo', 'o/r', '--issue', '7']).threshold, 60000);
  assert.throws(() => parseArgs(['--repo', 'o/r']), /Usage/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--repair']), /--out/);
  assert.throws(() => parseArgs(['--repo', 'o/r', '--issue', '7', '--threshold', '0']), /positive/);
});
