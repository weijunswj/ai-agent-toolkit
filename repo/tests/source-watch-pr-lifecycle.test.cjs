'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  exactPullRequests,
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

test('exactly one matching open PR is updated without create or reopen', () => {
  assert.deepEqual(plan([pullRequest({ number: 201, state: 'OPEN' })]), {
    action: 'update-open',
    prNumber: 201,
    conflictingPrNumbers: []
  });
});

test('historical closed PR #164 is reopened and updated rather than accepted as open', () => {
  const result = plan([pullRequest()]);
  assert.deepEqual(result, {
    action: 'reopen-and-update',
    prNumber: 164,
    conflictingPrNumbers: []
  });
  assert.notEqual(result.action, 'update-open');
});

test('most recently updated closed exact match is selected deterministically', () => {
  assert.deepEqual(plan([
    pullRequest({ number: 164, updatedAt: '2026-07-05T16:31:51Z' }),
    pullRequest({ number: 170, updatedAt: '2026-07-06T10:00:00Z' }),
    pullRequest({ number: 171, updatedAt: '2026-07-06T09:59:59Z' })
  ]), {
    action: 'reopen-and-update',
    prNumber: 170,
    conflictingPrNumbers: []
  });
});

test('equal closed timestamps use descending PR number as a stable tie-break', () => {
  assert.equal(plan([
    pullRequest({ number: 164 }),
    pullRequest({ number: 170 })
  ]).prNumber, 170);
});

test('no exact open or closed match creates one notification PR', () => {
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

test('merged PRs are not candidates for reopen', () => {
  assert.equal(plan([pullRequest({ state: 'MERGED' })]).action, 'create');
});

test('no actionable drift returns none even when matching PR metadata exists', () => {
  assert.deepEqual(plan([pullRequest({ state: 'OPEN' })], false), {
    action: 'none',
    prNumber: null,
    conflictingPrNumbers: []
  });
});

test('invalid matching closed timestamps fail closed', () => {
  assert.throws(
    () => plan([pullRequest({ updatedAt: 'not-a-timestamp' })]),
    /valid updatedAt timestamps/
  );
});

test('an open PR appearing between planning and reopen rejects the stale plan', () => {
  const original = plan([pullRequest()]);
  const fresh = plan([pullRequest(), pullRequest({ number: 201, state: 'OPEN' })]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('an open PR appearing between planning and create rejects the stale plan', () => {
  const original = plan([]);
  const fresh = plan([pullRequest({ number: 201, state: 'OPEN' })]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('a changed closed PR selection rejects the stale reopen plan', () => {
  const original = plan([pullRequest()]);
  const fresh = plan([
    pullRequest(),
    pullRequest({ number: 170, updatedAt: '2026-07-06T10:00:00Z' })
  ]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('a changed open PR selection rejects the stale edit plan', () => {
  const original = plan([pullRequest({ number: 201, state: 'OPEN' })]);
  const fresh = plan([pullRequest({ number: 202, state: 'OPEN' })]);
  assert.throws(() => requireFreshPlan(original, fresh), /stale source-watch PR lifecycle plan/);
});

test('an unchanged fresh plan proceeds normally', () => {
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
