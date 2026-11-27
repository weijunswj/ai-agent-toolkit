'use strict';

// The sweep names a pull request ready to land that no train holds while a landing is in flight
// (TRAIN_BOARD_DUE), and a bot's pull request at once (BOT_PR_OPEN), both called out to the
// controller's turn-end check the same turn. Red on the parent: neither code existed, a ready pull
// request beside a running landing was named nowhere, and a bot's pull request waited 24 hours for
// PR_UNOWNED (the shard timings refresh sat open behind main for 4 hours on 26 November 2026).

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const HOUR = 3600 * 1000;
const START = Date.parse('2026-11-27T09:00:00Z');
const iso = ms => new Date(ms).toISOString();
const sha = character => character.repeat(40);
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const check = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion, completedAt: status === 'COMPLETED' ? iso(START) : null, checkSuite: { app: { databaseId: 15368 } }, isRequired: false });
const GREEN = [check('validate', 'COMPLETED', 'SUCCESS')];
const RUNNING = [check('validate', 'IN_PROGRESS', null)];
const RED = [check('validate', 'COMPLETED', 'FAILURE')];

function fixture() {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  github.clock = START;
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'INT-TK421-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  github.addIssue(421, { body: '## CURRENT\n' });
  const fx = { github, binding, now: START };
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => iso(fx.now), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: [] }), controller, {}), { sha: null, previous: null });
  fx.parent = () => store.read('parent', 421).doc;
  fx.pr = (number, { head = sha('a'), checks = GREEN, ...options } = {}) => github.addPr(number, { head, contexts: checks, createdAt: iso(START - HOUR), ...options });
  fx.pass_ = (number, head) => github.addComment(number, { body: `Toolkit-G2: PASS ${head} tier=NORMAL\nRoute: host-verified opus-5.5/xhigh pin=owner-claude/opus`, association: 'OWNER' });
  fx.train = (number, members) => fx.pr(number, { head: sha('e'), branch: 'toolkit-train/one',
    body: `## Merge train\n\n| Member | Reviewed head | Tier | Bump | Review |\n|---|---|---|---|---|\n${members.map(([pr, head]) => `| #${pr} | \`${head}\` | NORMAL | patch | x |`).join('\n')}\n` });
  fx.pass = () => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    binding, writer: state.refreshWriter(fx.parent()), toolkitVersion: '3.9.0', refreshFacts: true, now: () => iso(fx.now) }).run({ apply: true });
  fx.open = code => (fx.parent().attention || []).filter(entry => entry.code === code && ['new', 'acknowledged'].includes(entry.state)).map(entry => entry.issue).sort((a, b) => a - b);
  return fx;
}

test('a ready pull request no train holds is named while a train is open, at once, with its head', () => {
  const fx = fixture();
  fx.train(50, [[7, sha('7')]]);
  fx.pr(7, { head: sha('7') }); fx.pass_(7, sha('7')); // on the train
  fx.pr(8, { head: sha('8') }); fx.pass_(8, sha('8')); // ready, on no train
  fx.pr(9, { head: sha('9'), checks: RED }); fx.pass_(9, sha('9')); // red
  fx.pr(10, { head: sha('b') }); fx.github.addComment(10, { body: `Toolkit-G2: FAIL ${sha('b')} tier=NORMAL`, association: 'OWNER' }); // failed review
  fx.pr(11, { head: sha('c') }); fx.github.addComment(11, { body: `Toolkit-G2: PASS ${sha('c')} tier=NORMAL`, association: 'CONTRIBUTOR' }); // not a writer
  fx.pr(12, { head: sha('d'), isDraft: true }); fx.pass_(12, sha('d')); // draft
  fx.pass();
  assert.deepEqual(fx.open('TRAIN_BOARD_DUE'), [8]);
  const entry = fx.parent().attention.find(row => row.code === 'TRAIN_BOARD_DUE');
  assert.equal(entry.head, sha('8'));
  // Called out to the turn-end check at once, not after four hours.
  const callout = state.netCallout(fx.parent().attention, START);
  assert.ok(callout.entries.some(row => row.code === 'TRAIN_BOARD_DUE' && row.ref === 'PR #8'), JSON.stringify(callout.entries));
});

test('main\'s required checks running count as a landing in flight; nothing in flight names nothing', () => {
  const fx = fixture();
  fx.pr(8, { head: sha('8') }); fx.pass_(8, sha('8'));
  fx.github.mainContexts = RUNNING;
  fx.pass();
  assert.deepEqual(fx.open('TRAIN_BOARD_DUE'), [8]);
  // Main's checks done and no train open: it lands alone, and the finding clears.
  fx.github.mainContexts = GREEN;
  fx.now += 60000;
  fx.pass();
  assert.deepEqual(fx.open('TRAIN_BOARD_DUE'), []);
});

// G2 Low: right after a merge GitHub has not made main's check runs yet, so a required check with no run
// at a new main head counts as running (a landing in flight); once the head is ten minutes old, a check
// with no run there (one that runs on pull requests only) does not hold a landing open.
test('a required check with no run yet at a new main head is a landing in flight, until the head is ten minutes old', () => {
  const fx = fixture();
  fx.pr(8, { head: sha('8') }); fx.pass_(8, sha('8'));
  fx.github.mainContexts = [];
  fx.github.mainCommittedAt = iso(START - 60000);
  fx.pass();
  assert.deepEqual(fx.open('TRAIN_BOARD_DUE'), [8]);
  fx.now = START + 10 * 60000;
  fx.github.clock = fx.now;
  fx.pass();
  assert.deepEqual(fx.open('TRAIN_BOARD_DUE'), [], 'eleven minutes on, a check that never ran on main holds nothing');
});

test('a bot\'s pull request is named on the first sweep that sees it; a dependency update is left to its own workflow', () => {
  const fx = fixture();
  fx.pr(20, { head: sha('2'), author: 'example-governance[bot]', branch: 'toolkit/shard-timings-1' });
  fx.pr(21, { head: sha('3'), author: 'dependabot[bot]', branch: 'dependabot/npm/x' });
  fx.pr(22, { head: sha('4') });
  fx.pass();
  assert.deepEqual(fx.open('BOT_PR_OPEN'), [20]);
  assert.deepEqual(fx.open('PR_UNOWNED'), [], 'the other two are under 24 hours old');
  const callout = state.netCallout(fx.parent().attention, START);
  assert.ok(callout.entries.some(row => row.code === 'BOT_PR_OPEN' && row.ref === 'PR #20'));
  assert.match(state.FINDING_CODES.BOT_PR_OPEN.next_action, /gh pr update-branch <n>/);
});
