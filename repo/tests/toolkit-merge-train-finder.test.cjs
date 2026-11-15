'use strict';

// The merge train finder picks ready pull requests from GitHub facts (here a --live file) and writes
// the manifest build takes; it reads only, and every refusal names its reason.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const finder = require('../scripts/toolkit-merge-train-finder.cjs');
const { fixture } = require('./support/merge-train-fixture.cjs');

const sha = n => String(n).repeat(40).slice(0, 40);
const at = minutes => new Date(Date.UTC(2026, 10, 15, 0, minutes)).toISOString();
const verdict = (head, { result = 'PASS', tier = 'NORMAL', who = 'OWNER', when = 1 } = {}) => ({
  body: `Toolkit-G2: ${result} ${head} tier=${tier}\n---\nReport: evidence/g2.md`, author_association: who, created_at: at(when), html_url: `https://example.test/c/${head.slice(0, 4)}-${when}`,
});
const green = [{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }];
const pull = (number, extra = {}) => ({
  number, draft: false, base: { ref: 'main' }, head: { sha: sha(number) },
  body: `Change ${number}.\n\nBump: patch\nUAT: NOT_REQUIRED (internal)\n\nRefs #${number + 100}`, ...extra,
});

// A ready pull request: PASS at its head, green checks, Bump and UAT lines, no version file.
function ready(number, extra = {}) {
  return { pull: pull(number, extra.pull), comments: extra.comments || [verdict(sha(number))], checks: extra.checks || green, files: extra.files || ['b.txt'] };
}

function facts(f, entries, more = {}) {
  const file = path.join(f.root, 'facts.json');
  fs.writeFileSync(file, JSON.stringify({
    default_branch: 'main',
    pulls: [...entries.map(entry => entry.pull), ...(more.pulls || [])],
    comments: Object.fromEntries(entries.map(entry => [entry.pull.number, entry.comments])),
    checks: Object.fromEntries(entries.map(entry => [entry.pull.head.sha, entry.checks])),
    files: Object.fromEntries(entries.map(entry => [entry.pull.number, entry.files])),
  }));
  return file;
}

const find = (f, live, out = path.join(f.root, 'found.json')) => ({ result: train.run(['find', '--out', out, '--live', live], f.repo, f.opts), out });

test('verdicts: only an exact first line from a writer counts, and the newest for the head wins', () => {
  const head = sha(7);
  assert.equal(finder.verdictFor([verdict(head)], head).verdict, 'PASS');
  assert.equal(finder.verdictFor([verdict(head, { who: 'CONTRIBUTOR' })], head), null, 'a non-writer is ignored');
  assert.equal(finder.verdictFor([verdict(head, { who: 'NONE' })], head), null);
  assert.equal(finder.verdictFor([{ ...verdict(head), body: `Looks good.\nToolkit-G2: PASS ${head} tier=NORMAL` }], head), null, 'not the first line');
  assert.equal(finder.verdictFor([verdict(sha(8))], head), null, 'another head');
  assert.equal(finder.verdictFor([verdict(head, { when: 1 }), verdict(head, { result: 'FAIL', when: 2 })], head).verdict, 'FAIL');
  assert.equal(finder.verdictFor([verdict(head, { result: 'FAIL', when: 1 }), verdict(head, { tier: 'RISKY', when: 2 })], head).tier, 'RISKY');
  assert.deepEqual(finder.missingChecks([{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }, { id: 2, name: 'validate', status: 'completed', conclusion: 'failure' }], ['validate']), ['validate'], 'the latest run counts');
  assert.deepEqual(finder.packChanges('x\n## Pack changes\n\n- row-1: why\n- row-2: why\n\n## Next\n- not this'), ['- row-1: why', '- row-2: why']);
});

test('a verdict never lowers a tier: the risk-tier list of the changed files wins when it is higher', t => {
  const f = fixture(t);
  const live = facts(f, [
    ready(1, { comments: [verdict(sha(1), { tier: 'LIGHT' })], files: ['.github/workflows/ci.yml', 'repo/scripts/toolkit-merge-hold.cjs'] }),
    ready(2, { comments: [verdict(sha(2), { tier: 'RISKY' })], files: ['README.md'] }),
  ]);
  const { result, out } = find(f, live);
  assert.equal(result.written, true);
  const tiers = JSON.parse(fs.readFileSync(out, 'utf8')).members.map(member => [member.pr, member.tier]);
  assert.deepEqual(tiers, [[1, 'RISKY'], [2, 'RISKY']]);
});

test('an edited verdict counts from its edit', () => {
  const head = sha(7);
  const passEditedLater = { ...verdict(head, { when: 1 }), updated_at: at(5) };
  assert.equal(finder.verdictFor([passEditedLater, verdict(head, { result: 'FAIL', when: 3 })], head).verdict, 'PASS');
  assert.equal(finder.verdictFor([verdict(head, { when: 1 }), verdict(head, { result: 'FAIL', when: 3 })], head).verdict, 'FAIL');
});

test('find writes the manifest of ready pull requests, oldest first, that build takes as it is', t => {
  const f = fixture(t);
  const live = facts(f, [ready(3, { pull: { body: 'Three.\n\nBump: minor\nUAT: OWNER_TEST_NEEDED (try it)\n\nCloses #30\n\n## Pack changes\n\n- row-9: changed' } }), ready(2, { comments: [verdict(sha(2), { tier: 'RISKY' })] })]);
  const { result, out } = find(f, live);
  assert.equal(result.written, true, JSON.stringify(result));
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(manifest.repository, 'example/repo');
  assert.deepEqual(manifest.members.map(member => member.pr), [2, 3]);
  assert.deepEqual(manifest.members[0], { pr: 2, head: sha(2), g2: `https://example.test/c/${sha(2).slice(0, 4)}-1`, tier: 'RISKY', bump: 'patch', uat: 'UAT: NOT_REQUIRED (internal)', links: ['Refs #102'] });
  assert.equal(manifest.members[0].owner_ok, undefined, 'a RISKY member keeps the owner gate');
  assert.deepEqual([manifest.members[1].bump, manifest.members[1].uat, manifest.members[1].links, manifest.members[1].pack_changes], ['minor', 'UAT: OWNER_TEST_NEEDED (try it)', ['Closes #30'], ['- row-9: changed']]);
  assert.deepEqual(train.checkManifest(manifest).members.length, 2, 'build accepts it');
});

test('find skips each unready pull request with its reason', t => {
  const f = fixture(t);
  const live = facts(f, [
    ready(1), ready(2),
    ready(10, { pull: { draft: true } }),
    ready(11, { pull: { base: { ref: 'toolkit-train/one' } } }),
    ready(12, { comments: [verdict(sha(99))] }),
    ready(13, { comments: [verdict(sha(13), { when: 1 }), verdict(sha(13), { result: 'FAIL', when: 2 })] }),
    ready(14, { comments: [verdict(sha(14), { who: 'CONTRIBUTOR' })] }),
    ready(15, { checks: [{ id: 1, name: 'validate', status: 'in_progress', conclusion: null }] }),
    ready(16, { checks: [] }),
    ready(17, { pull: { body: 'No lines.\n\nUAT: NOT_REQUIRED (x)' } }),
    ready(18, { pull: { body: 'Two.\n\nBump: patch\nBump: minor\nUAT: NOT_REQUIRED (x)' } }),
    ready(19, { pull: { body: 'No UAT.\n\nBump: patch' } }),
    ready(20, { files: ['repo/contracts/toolkit-local-bridge/version.json'] }),
  ]);
  const { result, out } = find(f, live);
  assert.deepEqual(result.ready, ['#1', '#2']);
  const reasons = Object.fromEntries(result.skipped.map(line => line.split(': ').map((part, index, all) => (index ? all.slice(1).join(': ') : part)).slice(0, 2)));
  assert.equal(reasons['#10'], 'a draft');
  assert.match(reasons['#11'], /based on toolkit-train\/one, not main/);
  assert.match(reasons['#12'], /no review verdict comment for its head/);
  assert.match(reasons['#13'], /newest verdict .* is FAIL/);
  assert.match(reasons['#14'], /no review verdict comment/);
  assert.match(reasons['#15'], /required checks not green: validate/);
  assert.match(reasons['#16'], /required checks not green: validate/);
  assert.match(reasons['#17'], /exactly one Bump: line \(has 0\)/);
  assert.match(reasons['#18'], /exactly one Bump: line \(has 2\)/);
  assert.match(reasons['#19'], /no UAT: line/);
  assert.match(reasons['#20'], /carries its own version bump/);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).members.map(member => member.pr), [1, 2]);
});

test('find leaves out pull requests an open train holds, caps at six and writes nothing for fewer than two', t => {
  const f = fixture(t);
  const trainBody = `## Merge train\n\n| Member | Reviewed head | Tier | Bump | Review |\n|---|---|---|---|---|\n| #1 | \`${sha(1)}\` | NORMAL | patch | x |\n| #2 | \`${sha(2)}\` | NORMAL | patch | x |\n`;
  let live = facts(f, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ready(n)), { pulls: [{ number: 50, draft: false, base: { ref: 'main' }, head: { sha: sha(5) }, body: trainBody }] });
  let { result, out } = find(f, live);
  assert.deepEqual(result.ready, ['#3', '#4', '#5', '#6', '#7', '#8']);
  assert.ok(result.skipped.includes('#1: already on an open train'), result.skipped.join('\n'));
  assert.deepEqual(result.next, ['board the next train with #9']);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).members.length, 6);

  live = facts(f, [ready(4), ready(5, { checks: [] })]);
  const lone = path.join(f.root, 'lone.json');
  ({ result } = find(f, live, lone));
  assert.deepEqual([result.written, result.ready, result.next], [false, ['#4'], ['merge #4 alone: one ready pull request makes no train']]);
  assert.equal(fs.existsSync(lone), false);
});

test('find refuses where trains are off, like build', t => {
  const f = fixture(t);
  f.governed({ merge_train: 'off' });
  assert.throws(() => find(f, facts(f, [ready(1), ready(2)])), /merge trains are off here \(repository-off\)/);
  const cli = f.cli('find', '--out', path.join(f.root, 'x.json'), '--live', facts(f, [ready(1), ready(2)]));
  assert.equal(cli.status, 1);
});
