'use strict';

// land re-reads each member's live pull request body before it names a merge: a member whose UAT
// line is missing or invalid, or whose manifest line is weaker than its live line, refuses, so a
// stale or hand-built manifest never drops an owner test at merge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const { fixture, built, MEMBER_BODY } = require('./support/merge-train-fixture.cjs');

const bodyWith = line => `Change.\n\nBump: patch\n${line}\n\nRefs #101\n`;
const NONE = 'UAT: NOT_REQUIRED (internal)';
const OWED = 'UAT: OWNER_TEST_NEEDED (owner tries it)';
const PASS = 'UAT: PASSED (owner OK)';

// Each row: the live body of member #1 (null: the --live entry has no body), the manifest's line
// for #1, and what land answers.
const ROWS = [
  { row: 1, live: 'Change.\n\nBump: patch\n', uat: NONE, refuse: /^#1: UAT verdict missing in its live body/ },
  { row: 2, live: bodyWith('UAT: laptop paste check done'), uat: PASS, refuse: /^#1: UAT verdict invalid: the verdict must be NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED/ },
  { row: 3, live: bodyWith('- UAT: NOT_REQUIRED (x)'), uat: NONE, refuse: /^#1: UAT verdict invalid: write it at the start of a line/ },
  { row: 4, live: bodyWith(OWED), uat: NONE, refuse: /^#1: the manifest records UAT NOT_REQUIRED, weaker than its live OWNER_TEST_NEEDED/ },
  { row: 5, live: bodyWith(OWED), uat: PASS, refuse: /^#1: the manifest records UAT PASSED, weaker than its live OWNER_TEST_NEEDED/ },
  { row: 6, live: bodyWith(NONE), uat: NONE, lands: 'NOT_REQUIRED' },
  { row: 7, live: bodyWith(PASS), uat: OWED, lands: 'OWNER_TEST_NEEDED' },
  { row: 8, live: bodyWith(OWED), uat: OWED, lands: 'OWNER_TEST_NEEDED' },
  { row: 9, live: null, uat: NONE, throws: /--live has no body for #1/ },
];

test('land refuses a member whose live UAT line is missing, invalid or stricter than the manifest', async t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out, boarded } = built(f, [f.member(1, one), f.member(2, two)]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const live = path.join(f.root, 'live.json');
  const manifest = path.join(f.root, 'row.json');
  const land = () => train.run(['land', '--manifest', manifest, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo, f.opts);
  for (const row of ROWS) {
    await t.test(`row ${row.row}`, () => {
      const value = JSON.parse(JSON.stringify(boarded));
      value.members[0].uat = row.uat;
      fs.writeFileSync(manifest, JSON.stringify(value));
      const member = { state: 'OPEN', head: one, ...(row.live === null ? {} : { body: row.live }) };
      fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: result.head }, 1: member, 2: { state: 'OPEN', head: two, body: MEMBER_BODY } }));
      if (row.throws) { assert.throws(land, row.throws); return; }
      const landing = land();
      if (row.refuse) {
        assert.equal(landing.ok, false);
        assert.equal(landing.merge, null);
        assert.ok(landing.problems.some(problem => row.refuse.test(problem)), landing.problems.join('\n'));
        return;
      }
      assert.equal(landing.ok, true, JSON.stringify(landing));
      // The train line keeps the manifest's line when it is the stricter one.
      assert.match(train.body(value), new RegExp(`^UAT: ${row.lands} `, 'm'));
    });
  }
  // Untouched: the boarded manifest still lands at the same facts.
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: result.head }, 1: { state: 'OPEN', head: one, body: MEMBER_BODY }, 2: { state: 'OPEN', head: two, body: MEMBER_BODY } }));
  assert.equal(train.run(['land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo, f.opts).ok, true);
});

test('land names only the bad member and lists its UAT problem with every other problem', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two)]);
  const live = path.join(f.root, 'live.json');
  // Row 10: #1 is fine, #2 has no UAT line and the train pull request moved on.
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: 'e'.repeat(40) }, 1: { state: 'OPEN', head: one, body: MEMBER_BODY }, 2: { state: 'OPEN', head: two, body: 'Bump: patch\n' } }));
  const cli = f.cli('land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live);
  assert.equal(cli.status, 1, cli.stdout);
  const { problems, merge } = JSON.parse(cli.stdout);
  assert.equal(merge, null);
  assert.ok(problems.some(problem => /^#2: UAT verdict missing in its live body/.test(problem)), problems.join('\n'));
  assert.ok(problems.some(problem => /^the train pull request head is eeeeeeeeeeee/.test(problem)), problems.join('\n'));
  assert.equal(problems.filter(problem => /^#1\b/.test(problem)).length, 0, problems.join('\n'));
});
