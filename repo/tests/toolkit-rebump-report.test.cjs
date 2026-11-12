'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MARKER, commentBody, report, parseArgs } = require('../scripts/toolkit-rebump-report.cjs');

const MAIN = 'a'.repeat(40);
// A fake GitHub: comments per pull request, every call recorded.
function fakeGitHub(existing = {}) {
  const comments = new Map(Object.entries(existing).map(([number, list]) => [Number(number), list.map(item => ({ ...item }))]));
  const calls = []; let nextId = 100;
  const github = (args, input) => {
    calls.push({ args, input });
    const list = /^repos\/example\/toolkit\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)$/.exec(args[1]);
    if (args[0] === 'api' && args.length === 2 && list) return JSON.stringify(list[2] === '1' ? comments.get(Number(list[1])) || [] : []);
    const create = /^repos\/example\/toolkit\/issues\/(\d+)\/comments$/.exec(args[1]);
    if (create && args.includes('POST')) {
      const row = { id: nextId += 1, body: JSON.parse(input).body, user: { login: 'github-actions[bot]' } };
      comments.set(Number(create[1]), [...(comments.get(Number(create[1])) || []), row]); return JSON.stringify(row);
    }
    const edit = /^repos\/example\/toolkit\/issues\/comments\/(\d+)$/.exec(args[1]);
    if (edit && args.includes('PATCH')) {
      for (const rows of comments.values()) for (const row of rows) if (row.id === Number(edit[1])) { row.body = JSON.parse(input).body; return JSON.stringify(row); }
    }
    throw new Error(`unexpected GitHub call: ${args.join(' ')}`);
  };
  return { github, calls, comments, writes: () => calls.filter(call => call.args.includes('POST') || call.args.includes('PATCH')) };
}
const run = (results, fake) => report({ report: { mode: 'apply', repository: 'example/toolkit', results }, main: MAIN }, { github: fake.github });

test('a held pull request gets one comment, and the next run edits that same comment', () => {
  const fake = fakeGitHub();
  const first = run([{ number: 7, status: 'held', reason: 'source conflict: repo/scripts/a.cjs' }], fake);
  assert.deepEqual(first.actions, [{ number: 7, action: 'commented' }]);
  const [comment] = fake.comments.get(7);
  assert.ok(comment.body.startsWith(MARKER));
  assert.match(comment.body, /source conflict: repo\/scripts\/a\.cjs/);
  assert.match(comment.body, /aaaaaaa\b/);
  assert.doesNotMatch(comment.body, /Generated|Claude|Co-Authored/i);
  // Same reason on the next run: nothing is written.
  const before = fake.writes().length;
  assert.deepEqual(run([{ number: 7, status: 'held', reason: 'source conflict: repo/scripts/a.cjs' }], fake).actions, [{ number: 7, action: 'unchanged' }]);
  assert.equal(fake.writes().length, before);
  // A new reason edits the same comment; no second comment appears.
  assert.deepEqual(run([{ number: 7, status: 'held', reason: 'unfolded fragments need builder reconciliation' }], fake).actions, [{ number: 7, action: 'edited' }]);
  assert.equal(fake.comments.get(7).length, 1);
  assert.match(fake.comments.get(7)[0].body, /unfolded fragments/);
});

test('success writes no new comment; a held comment left from before is marked as cleared', () => {
  const fake = fakeGitHub({ 8: [{ id: 5, body: commentBody({ status: 'held', reason: 'x' }, MAIN), user: { login: 'github-actions[bot]' } }] });
  const result = run([
    { number: 7, status: 'verified', version: '3.2.0', head: 'b'.repeat(40) },
    { number: 8, status: 'verified', version: '3.2.0', head: 'c'.repeat(40) },
    { number: 9, status: 'unchanged' }, { number: 10, status: 'skipped', reason: 'no version bump' },
  ], fake);
  assert.deepEqual(result.actions, [{ number: 8, action: 'cleared' }]);
  assert.equal(fake.writes().length, 1);
  assert.match(fake.comments.get(8)[0].body, /Re-bumped to 3\.2\.0 at ccccccc\b/);
  assert.equal(fake.comments.has(7), false);
});

test('only the Action\'s own marked comment is edited, and odd reasons cannot break out of the comment', () => {
  const lookalike = { id: 3, body: `${MARKER}\nwritten by someone else`, user: { login: 'someone-else' } };
  const fake = fakeGitHub({ 7: [lookalike] });
  const reason = 'bad\n<!-- x --> `tick` @owner #12 ' + 'y'.repeat(900);
  assert.deepEqual(run([{ number: 7, status: 'held', reason }], fake).actions, [{ number: 7, action: 'commented' }]);
  assert.equal(fake.comments.get(7)[0].body, lookalike.body);
  const body = fake.comments.get(7)[1].body;
  assert.equal(body.split(MARKER).length, 2);
  assert.doesNotMatch(body.slice(MARKER.length), /<!--|`tick`|@owner|#12/);
  assert.ok(body.length < 1200);
});

test('a report that is not a re-bump report is refused, and so are bad arguments', () => {
  const fake = fakeGitHub();
  for (const bad of [null, {}, { repository: 'example/toolkit' }, { repository: '../x', results: [] }, { repository: 'example/toolkit', results: [{ number: '7', status: 'held' }] }]) {
    assert.throws(() => report({ report: bad, main: MAIN }, { github: fake.github }), /not a re-bump report/);
  }
  assert.throws(() => report({ report: { repository: 'example/toolkit', results: [] }, main: 'main' }, { github: fake.github }), /--main/);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(parseArgs(['--report', 'r.json', '--main', MAIN]), { report: 'r.json', main: MAIN });
  for (const argv of [[], ['--report', 'r.json'], ['--main', MAIN], ['--report', 'r.json', '--main', MAIN, '--force']]) assert.throws(() => parseArgs(argv), /usage/);
});

test('the summary lists every pull request with its result', () => {
  const fake = fakeGitHub();
  const { summary } = run([{ number: 7, status: 'held', reason: 'source conflict: a' }, { number: 9, status: 'verified', version: '3.2.0', head: 'b'.repeat(40) }, { number: 10, status: 'skipped', reason: 'author not listed' }], fake);
  assert.match(summary, /\| 7 \| held \| source conflict: a \|/);
  assert.match(summary, /\| 9 \| verified \| 3\.2\.0 at bbbbbbb \|/);
  assert.match(summary, /\| 10 \| skipped \| author not listed \|/);
});
