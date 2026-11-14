'use strict';

// The merge card readiness check (repo/scripts/toolkit-merge-card-ready.cjs): the card waits for a
// mergeable UAT line and a green Validate run on the exact head, and after the tap a changed body
// makes the merge wait, so no tap is spent on a refused merge.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const { bodySha, main } = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-merge-card-ready.cjs'));

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const GOOD_BODY = 'Summary\n\nUAT: NOT_REQUIRED (scripts and docs only)\n';
const run = (id, status, conclusion, minute) => ({ id, head_sha: HEAD, status, conclusion, created_at: `2026-11-14T07:${String(minute).padStart(2, '0')}:00Z` });

function call(argv, { pr = {}, runs = [run(1, 'completed', 'success', 0)], scope = { eligible: true, reasons: [] }, fail = '' } = {}) {
  const out = [], err = [], routes = [];
  const github = route => {
    routes.push(route);
    if (fail && route.includes(fail)) throw new (require(path.join(ROOT, 'repo', 'scripts', 'toolkit-merge-card-ready.cjs')).ReadError)('down');
    if (/\/pulls\/\d+$/.test(route)) return { state: 'open', merged: false, head: { sha: HEAD }, base: { sha: BASE }, body: GOOD_BODY, ...pr };
    if (/\/actions\/workflows\//.test(route)) return { workflow_runs: runs };
    throw new Error(`unexpected route ${route}`);
  };
  const code = main(argv, { stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, github, scope: () => scope });
  return { code, out: out.join(''), err: err.join(''), routes };
}
const ARGS = ['--repo', 'owner/name', '--pr', '12', '--head', HEAD];

test('ready: a mergeable UAT line and a green Validate run on the head; the card text and body sha are printed', () => {
  const result = call(ARGS);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, new RegExp(`^Ready for the merge card: Merge owner/name#12 at ${HEAD}\\? Validate run 1 is green and the UAT line is NOT_REQUIRED\\.`));
  assert.match(result.out, new RegExp(`Body sha256 ${bodySha(GOOD_BODY)}\\. From the card until it lands, edit nothing on this pull request`));
  assert.deepEqual(result.routes, ['repos/owner/name/pulls/12', `repos/owner/name/actions/workflows/validate.yml/runs?head_sha=${HEAD}&per_page=20`]);
  const rules = call([...ARGS, '--json'], { scope: { eligible: false, reasons: [{ path: 'repo/CONTROLLER.md', why: 'the controller rules' }] } });
  assert.equal(rules.code, 0, 'a merge-rule scope is what the card is for, not a reason to wait');
  assert.equal(JSON.parse(rules.out).merge_rules, true);
});

test('#1006: a body or title edit after the last green run (a newer run still going) holds the card', () => {
  const result = call(ARGS, { runs: [run(1, 'completed', 'success', 0), run(2, 'in_progress', null, 5)] });
  assert.equal(result.code, 1);
  assert.match(result.out, /the newest validate\.yml run on this head \(2\) is in_progress: a body, title or branch change started it; wait for it to go green/);
  assert.equal(call(ARGS, { runs: [run(2, 'completed', 'failure', 5), run(1, 'completed', 'success', 0)] }).code, 1, 'the newest run decides, whatever the order GitHub lists');
  assert.match(call(ARGS, { runs: [] }).out, /no validate\.yml run on this head yet/);
  const other = call(ARGS, { runs: [{ ...run(3, 'completed', 'success', 9), head_sha: 'c'.repeat(40) }] });
  assert.match(other.out, /no validate\.yml run on this head yet/, 'a run on another head never counts');
});

test('#1006: a UAT line that cannot merge is fixed before the card, never after the tap', () => {
  for (const body of ['No verdict here.\n', 'UAT: maybe (x)\n']) {
    const result = call(ARGS, { pr: { body } });
    assert.equal(result.code, 1);
    assert.match(result.out, /the body's UAT line does not let it merge .+fix the line now, before any card, then wait for the new Validate run to go green/);
  }
  assert.equal(call(ARGS, { pr: { body: 'UAT: OWNER_TEST_NEEDED (try the new card check)\n' } }).code, 0, 'an owner test after the merge still merges');
});

test('#1006: after the tap, a changed body makes the merge wait; an unchanged one is ready', () => {
  const same = call([...ARGS, '--body-sha', bodySha(GOOD_BODY)]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /^Ready to merge on the tap: head .+ and the body are unchanged since the card/);
  const changed = call([...ARGS, '--body-sha', bodySha(GOOD_BODY)], { pr: { body: `${GOOD_BODY}\nEdited after the tap.\n` } });
  assert.equal(changed.code, 1);
  assert.match(changed.out, /the body changed since the card was posted: the tap is stale; withdraw that card/);
});

test('a moved head, a closed pull request, bad arguments or an unreadable GitHub or git never read as ready', () => {
  assert.match(call(ARGS, { pr: { head: { sha: 'd'.repeat(40) } } }).out, /the head moved to dddddddddddd/);
  assert.match(call(ARGS, { pr: { state: 'closed', merged: true } }).out, /the pull request is merged, not open/);
  for (const argv of [[], ['--repo', 'owner/name', '--pr', '12', '--head', 'abc'], [...ARGS, '--body-sha', 'short'], [...ARGS, '--workflow', '../x.yml'], ['--repo', 'bad repo', '--pr', '1', '--head', HEAD]]) {
    assert.equal(call(argv).code, 2, JSON.stringify(argv));
  }
  const down = call(ARGS, { fail: 'actions/workflows' });
  assert.equal(down.code, 2);
  assert.match(down.err, /^Merge card check could not finish: down\. Nothing is ready until it does\./);
  const noGit = call(ARGS, { scope: null });
  assert.equal(noGit.code, 2);
  assert.match(noGit.err, /fetch the pull request head and its base/);
});
