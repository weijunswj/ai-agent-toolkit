'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  exactPullRequests,
  isNotifierAuthored,
  planLifecycle,
  requireFreshPlan
} = require('../scripts/plan-source-watch-pr-lifecycle.cjs');

const target = {
  repository: 'weijunswj/ai-agent-toolkit',
  owner: 'weijunswj',
  head: 'source-watch/review-active-third-party-updates',
  base: 'main'
};

function pullRequest(overrides = {}) {
  return {
    repository: target.repository,
    number: 164,
    state: 'CLOSED',
    headRefName: target.head,
    baseRefName: target.base,
    headRepositoryOwner: { login: target.owner },
    headRepository: { nameWithOwner: target.repository },
    isCrossRepository: false,
    updatedAt: '2026-07-05T16:31:51Z',
    ...overrides
  };
}

function plan(pullRequests, actionable = true) {
  return planLifecycle({ ...target, actionable, pullRequests });
}

test('exactly one matching open PR is updated without creating another', () => {
  assert.deepEqual(plan([pullRequest({ number: 201, state: 'OPEN' })]), {
    action: 'update-open',
    prNumber: 201,
    conflictingPrNumbers: []
  });
});

test('historical closed PR #164 does not block creation of a new notification PR', () => {
  assert.deepEqual(plan([pullRequest()]), {
    action: 'create',
    prNumber: null,
    conflictingPrNumbers: []
  });
});

test('multiple historical closed PRs do not affect lifecycle selection', () => {
  assert.deepEqual(plan([
    pullRequest({ number: 164 }),
    pullRequest({ number: 170 }),
    pullRequest({ number: 171 })
  ]), {
    action: 'create',
    prNumber: null,
    conflictingPrNumbers: []
  });
});

test('no matching open PR creates one notification PR', () => {
  assert.deepEqual(plan([]), {
    action: 'create',
    prNumber: null,
    conflictingPrNumbers: []
  });
});

test('multiple matching open PRs fail closed and list exact conflicts', () => {
  assert.deepEqual(plan([
    pullRequest({ number: 205, state: 'OPEN' }),
    pullRequest({ number: 201, state: 'OPEN' })
  ]), {
    action: 'fail-ambiguous-open',
    prNumber: null,
    conflictingPrNumbers: [201, 205]
  });
});

test('wrong base, wrong head, wrong repository, wrong owner, and forks are not matches', () => {
  const nonMatches = [
    pullRequest({ number: 1, baseRefName: 'release' }),
    pullRequest({ number: 2, headRefName: 'source-watch/other' }),
    pullRequest({
      number: 3,
      repository: 'someone/ai-agent-toolkit',
      headRepository: { nameWithOwner: 'someone/ai-agent-toolkit' }
    }),
    pullRequest({ number: 4, headRepositoryOwner: { login: 'someone' } }),
    pullRequest({ number: 5, isCrossRepository: true })
  ];
  assert.deepEqual(exactPullRequests({ ...target, pullRequests: nonMatches }).pullRequests, []);
  assert.equal(plan(nonMatches).action, 'create');
});

test('matching is exact and does not trim or fold case', () => {
  const nonMatches = [
    pullRequest({ number: 1, headRefName: ` ${target.head}` }),
    pullRequest({ number: 2, baseRefName: 'Main' }),
    pullRequest({ number: 3, headRepositoryOwner: { login: 'WeiJunSWJ' } }),
    pullRequest({ number: 4, repository: `${target.repository} ` })
  ];
  assert.equal(plan(nonMatches).action, 'create');
});

test('merged PRs do not block creation', () => {
  assert.equal(plan([pullRequest({ state: 'MERGED' })]).action, 'create');
});

test('no actionable drift returns none for a matching PR that the notifier did not open', () => {
  assert.deepEqual(plan([pullRequest({ state: 'OPEN' })], false), {
    action: 'none',
    prNumber: null,
    conflictingPrNumbers: []
  });
});

test('closed PR metadata changes do not stale a create plan', () => {
  const original = plan([pullRequest()]);
  const fresh = plan([
    pullRequest(),
    pullRequest({ number: 170, updatedAt: '2026-07-06T10:00:00Z' })
  ]);
  assert.deepEqual(requireFreshPlan(original, fresh), fresh);
});

test('an open PR appearing between planning and create rejects the stale plan', () => {
  const original = plan([pullRequest()]);
  const fresh = plan([pullRequest(), pullRequest({ number: 201, state: 'OPEN' })]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('a changed open PR selection rejects the stale edit plan', () => {
  const original = plan([pullRequest({ number: 201, state: 'OPEN' })]);
  const fresh = plan([pullRequest({ number: 202, state: 'OPEN' })]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('an unchanged fresh create plan proceeds normally', () => {
  const original = plan([pullRequest()]);
  const fresh = plan([pullRequest()]);
  assert.deepEqual(requireFreshPlan(original, fresh), fresh);
});

test('fresh ambiguity rejects the original single-open plan', () => {
  const original = plan([pullRequest({ number: 201, state: 'OPEN' })]);
  const fresh = plan([
    pullRequest({ number: 201, state: 'OPEN' }),
    pullRequest({ number: 202, state: 'OPEN' })
  ]);
  assert.throws(() => requireFreshPlan(original, fresh), /fresh plan is fail-ambiguous-open/);
});

const notifierAuthor = { login: 'app/github-actions', is_bot: true };

test('no actionable drift closes the single exact notification PR the bot opened', () => {
  for (const author of [notifierAuthor, { login: 'github-actions[bot]', is_bot: true }]) {
    assert.deepEqual(plan([pullRequest({ number: 579, state: 'OPEN', author })], false), {
      action: 'close-open',
      prNumber: 579,
      conflictingPrNumbers: []
    });
  }
});

test('no actionable drift with no open PR does nothing', () => {
  assert.equal(plan([], false).action, 'none');
  assert.equal(plan([pullRequest({ author: notifierAuthor })], false).action, 'none');
});

test('no actionable drift never closes a PR from a person, another bot, a fork or another branch', () => {
  const cases = [
    pullRequest({ number: 1, state: 'OPEN', author: { login: 'weijunswj', is_bot: false } }),
    pullRequest({ number: 2, state: 'OPEN', author: { login: 'app/github-actions', is_bot: false } }),
    pullRequest({ number: 3, state: 'OPEN', author: { login: 'app/dependabot', is_bot: true } }),
    pullRequest({ number: 4, state: 'OPEN', author: { login: 'App/github-actions', is_bot: true } }),
    pullRequest({ number: 5, state: 'OPEN', author: notifierAuthor, isCrossRepository: true }),
    pullRequest({ number: 6, state: 'OPEN', author: notifierAuthor, headRefName: 'source-watch/other' }),
    pullRequest({ number: 7, state: 'OPEN', author: notifierAuthor, baseRefName: 'release' })
  ];
  for (const pr of cases) {
    assert.equal(plan([pr], false).action, 'none', `PR #${pr.number}`);
  }
  assert.equal(isNotifierAuthored(pullRequest()), false);
});

test('no actionable drift with two exact open PRs fails closed and closes nothing', () => {
  assert.deepEqual(plan([
    pullRequest({ number: 205, state: 'OPEN', author: notifierAuthor }),
    pullRequest({ number: 201, state: 'OPEN', author: notifierAuthor })
  ], false), {
    action: 'fail-ambiguous-open',
    prNumber: null,
    conflictingPrNumbers: [201, 205]
  });
});

test('a close plan goes stale when the open PR changes before the close', () => {
  const original = plan([pullRequest({ number: 579, state: 'OPEN', author: notifierAuthor })], false);
  assert.throws(
    () => requireFreshPlan(original, plan([pullRequest({ number: 580, state: 'OPEN', author: notifierAuthor })], false)),
    /stale source-watch PR lifecycle plan/
  );
  assert.throws(() => requireFreshPlan(original, plan([], false)), /fresh plan is none/);
});
