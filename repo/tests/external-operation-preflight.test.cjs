'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'external-operation-preflight');
const checkerPath = path.join(skillRoot, 'scripts', 'preflight-check.cjs');
const examplePath = path.join(skillRoot, 'templates', 'operation-plan.example.json');
const {
  BACKUP_LEVELS, NON_PRODUCTION_WORDS, PLAN_SCHEMA, PRODUCTION_WORDS, REASONS, TEMPORARY_WORDS, TRIGGERS, checkPlan, planHash
} = require(checkerPath);

const NOW = Date.parse('2026-10-25T00:00:00Z');
const FUTURE = '2026-12-31';
const PAST = '2026-10-01';

function target(id, environment, providerEnvironment = environment, extra = {}) {
  return { id, kind: 'app', provider: 'platform', environment, provider_environment: providerEnvironment, temporary: false, ...extra };
}

function resource(id, nameEnvironment, providerEnvironment = nameEnvironment, extra = {}) {
  return {
    id, kind: 'database', provider: 'store', name_environment: nameEnvironment, provider_environment: providerEnvironment, temporary: false, ...extra
  };
}

const ROLLBACK = { plan: 'redeploy the previous revision in the same environment' };
const PROD_ROLLBACK = { ...ROLLBACK, environment: 'production' };
const BACKUP = { level: 'retrievable', reference: 'evidence store: restore check for this release' };

function write(targetId, resourceId) {
  return { target: targetId, resource: resourceId, access: 'write' };
}

function allow(resourceId, action, scope) {
  return { resource: resourceId, action, scope, effect: 'allow' };
}

function plan(overrides = {}) {
  const environment = overrides.environment || 'alpha';
  const base = {
    schema: PLAN_SCHEMA,
    operation: { action: 'deploy', environment, targets: ['app'], rollback: { ...ROLLBACK, environment }, backup_evidence: BACKUP },
    targets: [target('app', environment)],
    resources: [resource('db', environment), resource('bucket', environment)],
    bindings: [write('app', 'db'), write('app', 'bucket')],
    authority: [allow('app', 'deploy', environment)],
    exceptions: [],
    downstream: { trigger: 'NONE' }
  };
  const result = { ...base, ...overrides };
  delete result.environment;
  return result;
}

function codes(result) {
  return [...new Set(result.reasons.map((reason) => reason.code))].sort();
}

const temporaryComplete = {
  temporary: true,
  temporary_name: true,
  data_rule: 'synthetic data only',
  cleanup_owner: 'controller',
  end_date: FUTURE,
  removal_read_back: 'provider'
};

// M1: environment and resource binding.
const M1 = [
  {
    name: 'two alpha replicas on the same alpha database and bucket',
    plan: plan({
      operation: { action: 'deploy', environment: 'alpha', targets: ['app-1', 'app-2'] },
      targets: [target('app-1', 'alpha'), target('app-2', 'alpha')],
      bindings: [write('app-1', 'db'), write('app-1', 'bucket'), write('app-2', 'db'), write('app-2', 'bucket')],
      authority: [allow('app-1', 'deploy', 'alpha'), allow('app-2', 'deploy', 'alpha')]
    }),
    verdict: 'ALLOW',
    codes: []
  },
  { name: 'alpha on an alpha-bound database and bucket', plan: plan(), verdict: 'ALLOW', codes: [] },
  { name: 'production on a production-bound database and bucket', plan: plan({ environment: 'production' }), verdict: 'ALLOW', codes: [] },
  {
    name: 'restore on temporary resources with cleanup owner and end date',
    plan: plan({
      environment: 'restore',
      targets: [target('app', 'restore', 'restore', temporaryComplete)],
      resources: [resource('db', 'restore', 'restore', temporaryComplete), resource('bucket', 'restore', 'restore', temporaryComplete)]
    }),
    verdict: 'ALLOW',
    codes: []
  },
  {
    name: 'alpha bound to a database whose provider identity says production',
    plan: plan({ resources: [resource('db', 'alpha', 'production'), resource('bucket', 'alpha')] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'production bound to an alpha bucket',
    plan: plan({ environment: 'production', resources: [resource('db', 'production'), resource('bucket', 'alpha')] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'alpha and production on one writable bucket, no exception',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      resources: [resource('db', 'alpha'), resource('bucket', 'alpha')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'alpha and production on one writable bucket, with an owner exception',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      resources: [resource('db', 'alpha'), resource('bucket', 'alpha')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
      exceptions: [{ resources: ['bucket'], environments: ['production'], reason: 'shared media during migration', end_date: FUTURE }]
    }),
    verdict: 'ALLOW_WITH_NOTICE',
    codes: []
  },
  {
    name: 'owner exception whose end date has passed',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      resources: [resource('db', 'alpha'), resource('bucket', 'alpha')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
      exceptions: [{ resources: ['bucket'], environments: ['production'], reason: 'shared media during migration', end_date: PAST }]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'owner exception with no reason',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      resources: [resource('db', 'alpha'), resource('bucket', 'alpha')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
      exceptions: [{ resources: ['bucket'], environments: ['production'], reason: '', end_date: FUTURE }]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  ...['temporary_name', 'data_rule', 'cleanup_owner', 'end_date', 'removal_read_back'].map((missing) => {
    const partial = { ...temporaryComplete };
    delete partial[missing];
    return {
      name: `temporary resource missing ${missing}`,
      plan: plan({
        environment: 'restore',
        targets: [target('app', 'restore', 'restore', temporaryComplete)],
        resources: [resource('db', 'restore', 'restore', partial), resource('bucket', 'restore', 'restore', temporaryComplete)]
      }),
      verdict: 'HOLD',
      codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE]
    };
  }),
  {
    name: 'temporary resource whose end date has passed',
    plan: plan({
      environment: 'restore',
      targets: [target('app', 'restore', 'restore', temporaryComplete)],
      resources: [resource('db', 'restore', 'restore', { ...temporaryComplete, end_date: PAST }), resource('bucket', 'restore', 'restore', temporaryComplete)]
    }),
    verdict: 'HOLD',
    codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE]
  },
  {
    name: 'target name says alpha, provider says production',
    plan: plan({ targets: [target('app', 'alpha', 'production')] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'operation bound to alpha but names a production target',
    plan: plan({
      targets: [target('app', 'production')],
      resources: [resource('db', 'production'), resource('bucket', 'production')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'database branch named production bound to the alpha app (real case)',
    plan: plan({ resources: [resource('db', 'production', 'production'), resource('bucket', 'alpha')] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'two authority entries contradict for one resource and action',
    plan: plan({ authority: [allow('app', 'deploy', 'alpha'), { resource: 'app', action: 'deploy', scope: 'alpha', effect: 'deny' }] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_AUTHORITY_PROJECTION_CONFLICT]
  },
  { name: 'action with no matching authority entry', plan: plan({ authority: [] }), verdict: 'HOLD', codes: [REASONS.NOT_AUTHORISED] },
  {
    name: 'authority entry for another environment does not count',
    plan: plan({ authority: [allow('app', 'deploy', 'production')] }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
  },
  {
    name: 'authority entry for another action does not count',
    plan: plan({ authority: [allow('app', 'restart', 'alpha')] }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
  },
  {
    name: 'a deny entry alone refuses',
    plan: plan({ authority: [{ resource: 'app', action: 'deploy', scope: 'alpha', effect: 'deny' }] }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
  },
  {
    name: 'explicit action list needs authority for every action',
    plan: plan({
      operation: { action: 'deploy', environment: 'alpha', targets: ['app'], actions: [{ resource: 'bucket', action: 'create' }] }
    }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
  },
  {
    name: 'resource named production that the provider reports as alpha',
    plan: plan({ resources: [resource('db', 'production', 'alpha'), resource('bucket', 'alpha')] }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'alpha and production on one writable database, no exception',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'db')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'alpha and production on one writable database, with an owner exception',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'db')],
      exceptions: [{ resources: ['db'], environments: ['production'], reason: 'one-off data copy', end_date: FUTURE }]
    }),
    verdict: 'ALLOW_WITH_NOTICE',
    codes: []
  },
  {
    name: 'owner exception that names another resource does not cover this one',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
      exceptions: [{ resources: ['db'], environments: ['production'], reason: 'shared media during migration', end_date: FUTURE }]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'owner exception that names another environment does not cover this one',
    plan: plan({
      targets: [target('app', 'alpha'), target('app-prod', 'production')],
      bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
      exceptions: [{ resources: ['bucket'], environments: ['test'], reason: 'shared media during migration', end_date: FUTURE }]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  },
  {
    name: 'a restore-environment resource not marked temporary',
    plan: plan({
      environment: 'restore',
      targets: [target('app', 'restore', 'restore', temporaryComplete)],
      resources: [resource('db', 'restore', 'restore', temporaryComplete), resource('bucket', 'restore')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE]
  },
  {
    name: 'a temporary target missing its cleanup owner',
    plan: plan({
      environment: 'restore',
      targets: [target('app', 'restore', 'restore', { ...temporaryComplete, cleanup_owner: '' })],
      resources: [resource('db', 'restore', 'restore', temporaryComplete), resource('bucket', 'restore', 'restore', temporaryComplete)]
    }),
    verdict: 'HOLD',
    codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE]
  },
  {
    name: 'the operation\'s own action is checked even when extra actions are listed',
    plan: plan({
      operation: { action: 'delete', environment: 'alpha', targets: ['app'], actions: [{ resource: 'app', action: 'read' }] },
      authority: [allow('app', 'read', 'alpha')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
  },
  {
    name: 'an extra action on a production resource under an alpha operation',
    plan: plan({
      operation: { action: 'deploy', environment: 'alpha', targets: ['app'], actions: [{ resource: 'db-prod', action: 'migrate' }], rollback: { ...ROLLBACK, environment: 'alpha' }, backup_evidence: BACKUP },
      resources: [resource('db', 'alpha'), resource('bucket', 'alpha'), resource('db-prod', 'production')],
      authority: [allow('app', 'deploy', 'alpha'), allow('db-prod', 'migrate', 'alpha')]
    }),
    verdict: 'HOLD',
    codes: [REASONS.RESOURCE_IDENTITY_MISMATCH]
  }
];

test('M1: environment and resource binding', async (t) => {
  for (const row of M1) {
    await t.test(row.name, () => {
      const result = checkPlan(row.plan, { now: NOW });
      assert.equal(result.verdict, row.verdict, JSON.stringify(result.reasons));
      assert.deepEqual(codes(result), row.codes);
      if (row.verdict === 'ALLOW_WITH_NOTICE') assert.ok(result.notices.length > 0);
    });
  }
});

// M2: merge and auto-deploy. Every combination of trigger x deployment approved x pause read back x freeze.
function m2Expected(trigger, deploy, pause, freeze) {
  if (trigger === 'UNKNOWN') return { verdict: 'HOLD', codes: [REASONS.DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED], outcome: null };
  if (trigger === 'NONE' || trigger === 'MANUAL') return { verdict: 'ALLOW', codes: [], outcome: 'NO_COUPLED_EFFECT' };
  if (deploy && freeze) return { verdict: 'HOLD', codes: [REASONS.EVIDENCE_FREEZE_ACTIVE], outcome: null };
  if (deploy) return { verdict: 'ALLOW', codes: [], outcome: 'MERGE_WITH_COUPLED_DEPLOYMENT_ACCEPTED' };
  if (pause) return { verdict: 'ALLOW', codes: [], outcome: 'PAUSE_TRIGGER_THEN_MERGE' };
  return { verdict: 'HOLD', codes: [REASONS.DEFER_MERGE], outcome: null };
}

function mergePlan(downstream) {
  return plan({
    operation: { action: 'merge', environment: 'alpha', targets: ['app'] },
    authority: [allow('app', 'merge', 'alpha')],
    downstream
  });
}

test('M2: merge and auto-deploy, every combination', async (t) => {
  let rows = 0;
  for (const trigger of TRIGGERS) {
    for (const deploy of [true, false]) {
      for (const pause of [true, false]) {
        for (const freeze of [true, false]) {
          rows += 1;
          const expected = m2Expected(trigger, deploy, pause, freeze);
          await t.test(`${trigger} deploy=${deploy} pause=${pause} freeze=${freeze}`, () => {
            const result = checkPlan(mergePlan({
              trigger,
              deployment_approved: deploy,
              pause_read_back: pause,
              evidence_freeze: freeze,
              freeze_end_approved: false
            }), { now: NOW });
            assert.equal(result.verdict, expected.verdict, JSON.stringify(result.reasons));
            assert.deepEqual(codes(result), expected.codes);
            assert.equal(result.outcome, expected.outcome);
            if (expected.outcome === 'MERGE_WITH_COUPLED_DEPLOYMENT_ACCEPTED' || expected.outcome === 'PAUSE_TRIGGER_THEN_MERGE') {
              assert.ok(result.required_read_back.length > 0);
            }
          });
        }
      }
    }
  }
  assert.equal(rows, TRIGGERS.length * 8);
});

test('M2: an approval that ends the freeze lets the coupled deployment run', () => {
  const result = checkPlan(mergePlan({
    trigger: 'AUTO_ON_BRANCH_UPDATE', deployment_approved: true, pause_read_back: false, evidence_freeze: true, freeze_end_approved: true
  }), { now: NOW });
  assert.equal(result.verdict, 'ALLOW');
  assert.equal(result.outcome, 'MERGE_WITH_COUPLED_DEPLOYMENT_ACCEPTED');
  assert.ok(result.required_read_back.some((line) => /freeze/.test(line)));
});

test('M2: downstream and its flags are required and must be true or false', async (t) => {
  const autoFlags = { trigger: 'AUTO_ON_MERGE', deployment_approved: true, pause_read_back: false, evidence_freeze: true, freeze_end_approved: false };
  const rows = [
    { name: 'a merge with no downstream section', plan: mergePlan(undefined) },
    { name: 'a push with no downstream section', plan: plan({ operation: { action: 'push', environment: 'alpha', targets: ['app'] }, downstream: undefined }) },
    ...['"yes"', '"true"', '1'].map((raw) => ({
      name: `evidence_freeze written as ${raw}`,
      plan: mergePlan({ ...autoFlags, evidence_freeze: JSON.parse(raw) })
    })),
    ...['deployment_approved', 'pause_read_back', 'evidence_freeze', 'freeze_end_approved'].map((flag) => {
      const downstream = { ...autoFlags };
      delete downstream[flag];
      return { name: `automatic trigger with ${flag} left out`, plan: mergePlan(downstream) };
    }),
    { name: 'a flag that is not true or false on a manual trigger', plan: mergePlan({ trigger: 'MANUAL', deployment_approved: 'no' }) }
  ];
  for (const row of rows) {
    await t.test(row.name, () => {
      const result = checkPlan(row.plan, { now: NOW });
      assert.equal(result.verdict, 'HOLD');
      assert.deepEqual(codes(result), [REASONS.PLAN_INVALID]);
    });
  }
});

test('production changes need rollback and backup evidence', async (t) => {
  const prod = (operation) => plan({ environment: 'production', operation: { action: 'migrate', environment: 'production', targets: ['app'], ...operation }, authority: [allow('app', 'migrate', 'production')] });
  const rows = [
    { name: 'migrate with rollback and retrievable backup evidence', plan: prod({ rollback: PROD_ROLLBACK, backup_evidence: BACKUP }), verdict: 'ALLOW', codes: [] },
    { name: 'migrate with neither', plan: prod({}), verdict: 'HOLD', codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'migrate with no rollback plan', plan: prod({ backup_evidence: BACKUP }), verdict: 'HOLD', codes: [REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'rollback in another environment', plan: prod({ rollback: { ...ROLLBACK, environment: 'alpha' }, backup_evidence: BACKUP }), verdict: 'HOLD', codes: [REASONS.ROLLBACK_EVIDENCE_MISSING] },
    ...BACKUP_LEVELS.slice(0, BACKUP_LEVELS.indexOf('retrievable')).map((level) => ({
      name: `backup evidence only at level ${level}`,
      plan: prod({ rollback: PROD_ROLLBACK, backup_evidence: { ...BACKUP, level } }),
      verdict: 'HOLD',
      codes: [REASONS.BACKUP_EVIDENCE_MISSING]
    })),
    { name: 'backup evidence with no reference', plan: prod({ rollback: PROD_ROLLBACK, backup_evidence: { level: 'fully_recoverable' } }), verdict: 'HOLD', codes: [REASONS.BACKUP_EVIDENCE_MISSING] },
    { name: 'backup evidence with an unknown level', plan: prod({ rollback: PROD_ROLLBACK, backup_evidence: { ...BACKUP, level: 'great' } }), verdict: 'HOLD', codes: [REASONS.BACKUP_EVIDENCE_MISSING] },
    {
      name: 'a production restart needs rollback but no backup evidence',
      plan: plan({ environment: 'production', operation: { action: 'restart', environment: 'production', targets: ['app'], rollback: PROD_ROLLBACK }, authority: [allow('app', 'restart', 'production')] }),
      verdict: 'ALLOW',
      codes: []
    },
    {
      name: 'a production restart with an auto-deploy coupled still needs backup evidence',
      plan: plan({
        environment: 'production',
        operation: { action: 'restart', environment: 'production', targets: ['app'], rollback: PROD_ROLLBACK },
        authority: [allow('app', 'restart', 'production')],
        downstream: { trigger: 'AUTO_ON_BRANCH_UPDATE', deployment_approved: true, pause_read_back: false, evidence_freeze: false, freeze_end_approved: false }
      }),
      verdict: 'HOLD',
      codes: [REASONS.BACKUP_EVIDENCE_MISSING]
    },
    {
      name: 'an alpha migrate needs neither',
      plan: plan({ operation: { action: 'migrate', environment: 'alpha', targets: ['app'] }, authority: [allow('app', 'migrate', 'alpha')] }),
      verdict: 'ALLOW',
      codes: []
    }
  ];
  for (const row of rows) {
    await t.test(row.name, () => {
      const result = checkPlan(row.plan, { now: NOW });
      assert.equal(result.verdict, row.verdict, JSON.stringify(result.reasons));
      assert.deepEqual(codes(result), [...row.codes].sort());
    });
  }
});

test('routes: fallback rules', async (t) => {
  const first = { route: 'mcp', target: 'app', privilege: 'deploy', credential: 'PLATFORM_ALPHA_TOKEN', effect: 'deploy' };
  const rows = [
    { name: 'one selected route', routes: [{ ...first, outcome: 'selected', pre_approved: true }], verdict: 'ALLOW', codes: [] },
    {
      name: 'pre-approved fallback after a failure before any effect',
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'api', outcome: 'selected', pre_approved: true }],
      verdict: 'ALLOW_WITH_NOTICE',
      codes: []
    },
    {
      name: 'fallback that is not pre-approved',
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'api', outcome: 'selected', pre_approved: false }],
      verdict: 'HOLD',
      codes: [REASONS.ROUTE_FALLBACK_REFUSED]
    },
    {
      name: 'pre-approved written as "yes"',
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'api', outcome: 'selected', pre_approved: 'yes' }],
      verdict: 'HOLD',
      codes: [REASONS.PLAN_INVALID]
    },
    ...['target', 'privilege', 'effect'].map((key) => ({
      name: `fallback that changes ${key}`,
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'browser', [key]: 'other', outcome: 'selected', pre_approved: true }],
      verdict: 'HOLD',
      codes: [REASONS.ROUTE_FALLBACK_REFUSED]
    })),
    {
      name: 'fallback that changes the credential',
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'api', credential: 'PLATFORM_ROOT_TOKEN', outcome: 'selected', pre_approved: true }],
      verdict: 'HOLD',
      codes: [REASONS.ROUTE_FALLBACK_REFUSED]
    },
    ...['failed_after_effect', 'outcome_unknown'].map((outcome) => ({
      name: `earlier route ${outcome}`,
      routes: [{ ...first, outcome }, { ...first, route: 'api', outcome: 'selected', pre_approved: true }],
      verdict: 'HOLD',
      codes: [REASONS.PRIOR_ATTEMPT_AMBIGUOUS]
    })),
    {
      name: 'no selected route',
      routes: [{ ...first, outcome: 'failed_before_effect' }],
      verdict: 'HOLD',
      codes: [REASONS.PLAN_INVALID]
    }
  ];
  for (const row of rows) {
    await t.test(row.name, () => {
      const result = checkPlan(plan({ routes: row.routes }), { now: NOW });
      assert.equal(result.verdict, row.verdict, JSON.stringify(result.reasons));
      assert.deepEqual(codes(result), row.codes);
    });
  }
});

test('plan shape and secrets fail closed', async (t) => {
  const rows = [
    { name: 'not an object', plan: [], code: REASONS.PLAN_INVALID },
    { name: 'wrong schema', plan: plan({ schema: 'other' }), code: REASONS.PLAN_INVALID },
    { name: 'no environment', plan: plan({ operation: { action: 'deploy', targets: ['app'] } }), code: REASONS.PLAN_INVALID },
    { name: 'unknown target', plan: plan({ operation: { action: 'deploy', environment: 'alpha', targets: ['ghost'] } }), code: REASONS.PLAN_INVALID },
    { name: 'resource with no provider read-back', plan: plan({ resources: [{ id: 'db', name_environment: 'alpha', temporary: false }, resource('bucket', 'alpha')] }), code: REASONS.PLAN_INVALID },
    { name: 'resource with temporary left out', plan: plan({ resources: [{ ...resource('db', 'alpha'), temporary: undefined }, resource('bucket', 'alpha')] }), code: REASONS.PLAN_INVALID },
    { name: 'target with temporary written as "yes"', plan: plan({ targets: [target('app', 'alpha', 'alpha', { temporary: 'yes' })] }), code: REASONS.PLAN_INVALID },
    { name: 'unknown trigger', plan: plan({ downstream: { trigger: 'SOMETIMES' } }), code: REASONS.PLAN_INVALID },
    { name: 'bad binding access', plan: plan({ bindings: [{ target: 'app', resource: 'db', access: 'admin' }] }), code: REASONS.PLAN_INVALID },
    { name: 'empty extra action list', plan: plan({ operation: { action: 'deploy', environment: 'alpha', targets: ['app'], actions: [] }, authority: [] }), code: REASONS.PLAN_INVALID },
    {
      name: 'extra action on an undeclared id',
      plan: plan({ operation: { action: 'deploy', environment: 'alpha', targets: ['app'], actions: [{ resource: 'prod-dns-zone', action: 'delete' }] }, authority: [allow('app', 'deploy', 'alpha'), allow('prod-dns-zone', 'delete', 'alpha')] }),
      code: REASONS.PLAN_INVALID
    },
    { name: 'token-shaped value', plan: plan({ note: `ghp_${'a'.repeat(36)}` }), code: REASONS.SECRET_IN_PLAN },
    { name: 'URL with a password', plan: plan({ note: 'postgres://user:hunter2@db.example.test/app' }), code: REASONS.SECRET_IN_PLAN },
    { name: 'value under a secret-named key', plan: plan({ api_token: 'plain-value-here' }), code: REASONS.SECRET_IN_PLAN },
    { name: 'value under a camel-case secret key', plan: plan({ clientSecret: 'plain-value-here' }), code: REASONS.SECRET_IN_PLAN },
    { name: 'upper-case value that is not a key name', plan: plan({ accessToken: 'HUNTER2' }), code: REASONS.SECRET_IN_PLAN },
    { name: 'numeric password', plan: plan({ db_password: 123456 }), code: REASONS.SECRET_IN_PLAN }
  ];
  for (const row of rows) {
    await t.test(row.name, () => {
      const result = checkPlan(row.plan, { now: NOW });
      assert.equal(result.verdict, 'HOLD');
      assert.ok(codes(result).includes(row.code), JSON.stringify(result.reasons));
    });
  }
  await t.test('a key name under a secret-named key is a reference, not a value', () => {
    assert.equal(checkPlan(plan({ api_token: 'COOLIFY_ALPHA_TOKEN' }), { now: NOW }).verdict, 'ALLOW');
  });
  await t.test('a token used as an id is reported by place, never echoed', () => {
    const token = `ghp_${'b'.repeat(36)}`;
    const result = checkPlan(plan({ operation: { action: 'deploy', environment: 'alpha', targets: [token] } }), { now: NOW });
    assert.deepEqual(codes(result), [REASONS.SECRET_IN_PLAN]);
    assert.equal(JSON.stringify(result).includes(token), false);
  });
});

function envPlan(environment, operation = {}) {
  return plan({
    environment,
    operation: { action: 'migrate', environment, targets: ['app'], ...operation },
    authority: [allow('app', 'migrate', environment)]
  });
}

test('production is any environment that is not plainly non-production', async (t) => {
  for (const environment of ['production', 'Production', 'prod', 'PROD', 'live', 'prd', 'prod-eu', 'production-eu', 'prod1', 'main', 'staging-prod']) {
    await t.test(`${environment} needs rollback and backup evidence`, () => {
      const result = checkPlan(envPlan(environment), { now: NOW });
      assert.equal(result.verdict, 'HOLD');
      assert.deepEqual(codes(result), [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING]);
      const covered = checkPlan(envPlan(environment, { rollback: { ...ROLLBACK, environment }, backup_evidence: BACKUP }), { now: NOW });
      assert.equal(covered.verdict, 'ALLOW', JSON.stringify(covered.reasons));
    });
  }
  for (const environment of ['alpha', 'alpha-eu', 'beta', 'staging', 'stage', 'dev', 'development', 'qa', 'uat', 'sandbox', 'local']) {
    await t.test(`${environment} needs neither`, () => {
      assert.equal(checkPlan(envPlan(environment), { now: NOW }).verdict, 'ALLOW');
    });
  }
  for (const environment of ['dr-restore', 'restore-drill', 'preview-42', 'load-test']) {
    await t.test(`${environment} resources must be temporary`, () => {
      const result = checkPlan(envPlan(environment), { now: NOW });
      assert.equal(result.verdict, 'HOLD');
      assert.deepEqual(codes(result), [REASONS.TEMPORARY_RESOURCE_INCOMPLETE], JSON.stringify(result.reasons));
    });
  }
});

test('a production store reached through an owner exception still needs rollback and backup evidence', () => {
  const exceptionPlan = (operation) => plan({
    operation: { action: 'deploy', environment: 'alpha', targets: ['app'], ...operation },
    resources: [resource('db', 'alpha'), resource('bucket', 'alpha'), resource('db-prod', 'production')],
    bindings: [write('app', 'db'), write('app', 'bucket'), write('app', 'db-prod')],
    exceptions: [{ resources: ['db-prod'], environments: ['alpha'], reason: 'one-off data copy', end_date: FUTURE }]
  });
  const bare = checkPlan(exceptionPlan({}), { now: NOW });
  assert.equal(bare.verdict, 'HOLD');
  assert.deepEqual(codes(bare), [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING]);
  const covered = checkPlan(exceptionPlan({ rollback: { ...ROLLBACK, environment: 'alpha' }, backup_evidence: BACKUP }), { now: NOW });
  assert.equal(covered.verdict, 'ALLOW_WITH_NOTICE', JSON.stringify(covered.reasons));
});

test('remaining refusal rules each have a row', async (t) => {
  const crossBucket = (exception) => plan({
    targets: [target('app', 'alpha'), target('app-prod', 'production')],
    bindings: [write('app', 'db'), write('app', 'bucket'), write('app-prod', 'bucket')],
    exceptions: [exception]
  });
  const first = { route: 'mcp', target: 'app', privilege: 'deploy', credential: 'PLATFORM_ALPHA_TOKEN', effect: 'deploy' };
  const rows = [
    { name: 'authority entry for another resource does not count', plan: plan({ authority: [allow('bucket', 'deploy', 'alpha')] }), codes: [REASONS.NOT_AUTHORISED] },
    { name: 'owner exception with no end date', plan: crossBucket({ resources: ['bucket'], environments: ['production'], reason: 'shared media' }), codes: [REASONS.RESOURCE_IDENTITY_MISMATCH] },
    { name: 'owner exception ending on 2026-02-30', plan: crossBucket({ resources: ['bucket'], environments: ['production'], reason: 'shared media', end_date: '2026-02-30' }), codes: [REASONS.RESOURCE_IDENTITY_MISMATCH] },
    { name: 'owner exception whose resources is a string', plan: crossBucket({ resources: 'bucket', environments: ['production'], reason: 'shared media', end_date: FUTURE }), codes: [REASONS.PLAN_INVALID] },
    { name: 'owner exception whose environments is empty', plan: crossBucket({ resources: ['bucket'], environments: [], reason: 'shared media', end_date: FUTURE }), codes: [REASONS.PLAN_INVALID] },
    { name: 'production rollback with no environment', plan: envPlan('production', { rollback: ROLLBACK, backup_evidence: BACKUP }), codes: [REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'rollback that is not an object', plan: envPlan('production', { rollback: 'redeploy', backup_evidence: BACKUP }), codes: [REASONS.PLAN_INVALID] },
    { name: 'backup evidence that is not an object', plan: envPlan('production', { rollback: PROD_ROLLBACK, backup_evidence: 'retrievable' }), codes: [REASONS.PLAN_INVALID] },
    { name: 'two resources with one id', plan: plan({ resources: [resource('db', 'alpha'), resource('db', 'production'), resource('bucket', 'alpha')] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'target with no environment', plan: plan({ targets: [{ ...target('app', 'alpha'), environment: '' }] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'resource with no name environment', plan: plan({ resources: [{ ...resource('db', 'alpha'), name_environment: undefined }, resource('bucket', 'alpha')] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'binding to an undeclared resource', plan: plan({ bindings: [write('app', 'ghost')] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'authority entry with an unknown effect', plan: plan({ authority: [{ resource: 'app', action: 'deploy', scope: 'alpha', effect: 'maybe' }] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'route with an unknown outcome', plan: plan({ routes: [{ ...first, outcome: 'skipped' }, { ...first, route: 'api', outcome: 'selected', pre_approved: true }] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'two selected routes', plan: plan({ routes: [{ ...first, outcome: 'selected', pre_approved: true }, { ...first, route: 'api', outcome: 'selected', pre_approved: true }] }), codes: [REASONS.PLAN_INVALID] },
    { name: 'selected route that is not last', plan: plan({ routes: [{ ...first, outcome: 'selected', pre_approved: true }, { ...first, route: 'api', outcome: 'failed_before_effect' }] }), codes: [REASONS.PLAN_INVALID] },
    {
      name: 'fallback with its fields left out on both routes',
      plan: plan({ routes: [{ route: 'mcp', outcome: 'failed_before_effect' }, { route: 'api', outcome: 'selected', pre_approved: true }] }),
      codes: [REASONS.ROUTE_FALLBACK_REFUSED]
    },
    { name: 'secret-shaped object key', plan: plan({ labels: { [`ghp_${'c'.repeat(36)}`]: 'x' } }), codes: [REASONS.SECRET_IN_PLAN] },
    {
      name: 'alpha deploy with a production target declared through an owner exception and no evidence',
      plan: {
        ...crossBucket({ resources: ['bucket'], environments: ['production'], reason: 'shared media', end_date: FUTURE }),
        operation: { action: 'deploy', environment: 'alpha', targets: ['app'] }
      },
      codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING]
    },
    { name: 'qa-prd is production', plan: envPlan('qa-prd'), codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'staging-live is production', plan: envPlan('staging-live'), codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'uat-production is production', plan: envPlan('uat-production'), codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.ROLLBACK_EVIDENCE_MISSING] },
    { name: 'drill resources must be temporary', plan: envPlan('drill'), codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE] },
    { name: 'testing resources must be temporary', plan: envPlan('testing'), codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE] },
    {
      name: 'production rollback with an environment but no plan',
      plan: envPlan('production', { rollback: { environment: 'production' }, backup_evidence: BACKUP }),
      codes: [REASONS.ROLLBACK_EVIDENCE_MISSING]
    },
    ...[
      ['target named alpha read back as production', [target('app', 'alpha', 'production')], [resource('db', 'alpha'), resource('bucket', 'alpha')]],
      ['target named production read back as alpha', [target('app', 'production', 'alpha')], [resource('db', 'alpha'), resource('bucket', 'alpha')]],
      ['resource named production read back as alpha', [target('app', 'alpha')], [resource('db', 'production', 'alpha'), resource('bucket', 'alpha')]],
      ['resource named alpha read back as production', [target('app', 'alpha')], [resource('db', 'alpha', 'production'), resource('bucket', 'alpha')]]
    ].map(([name, targets, resources]) => ({
      name: `${name} also needs production evidence`,
      plan: plan({ operation: { action: 'deploy', environment: 'alpha', targets: ['app'] }, targets, resources }),
      codes: [REASONS.BACKUP_EVIDENCE_MISSING, REASONS.RESOURCE_IDENTITY_MISMATCH, REASONS.ROLLBACK_EVIDENCE_MISSING]
    })),
    { name: 'selected route with an unknown name', plan: plan({ routes: [{ ...first, route: 'ssh', outcome: 'selected', pre_approved: true }] }), codes: [REASONS.PLAN_INVALID] }
  ];
  for (const row of rows) {
    await t.test(row.name, () => {
      const result = checkPlan(row.plan, { now: NOW });
      assert.equal(result.verdict, 'HOLD', JSON.stringify(result.reasons));
      assert.deepEqual(codes(result), row.codes);
    });
  }
});

test('plan hash is stable across key order and changes with content', () => {
  const a = plan();
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(planHash(a), planHash(reordered));
  assert.notEqual(planHash(a), planHash(plan({ environment: 'production' })));
  assert.equal(checkPlan(a, { now: NOW }).plan_sha256, planHash(a));
});

test('command line: example plan allows, a hold exits 2, usage errors exit 1', () => {
  const run = (args, input) => spawnSync(process.execPath, [checkerPath, ...args], { encoding: 'utf8', input });
  const example = run([examplePath, '--now', '2026-10-25']);
  assert.equal(example.status, 0, example.stderr);
  const output = JSON.parse(example.stdout);
  assert.equal(output.verdict, 'ALLOW');
  assert.equal(output.checked_at, '2026-10-25T00:00:00.000Z');

  const held = run(['--stdin', '--now', '2026-10-25'], JSON.stringify(plan({ authority: [] })));
  assert.equal(held.status, 2);
  assert.equal(JSON.parse(held.stdout).verdict, 'HOLD');

  assert.equal(run([]).status, 1);
  const notJson = run(['--stdin'], 'COOLIFY_TOKEN=abc123 not json');
  assert.equal(notJson.status, 1);
  assert.equal(notJson.stderr.includes('COOLIFY'), false, 'a parse error must not echo the input');
  assert.equal(run([examplePath, '--now', 'yesterday']).status, 1);
  assert.equal(run([examplePath, '--now', '2026-02-30']).status, 1);
  assert.equal(run([examplePath, '--now']).status, 1);
  assert.equal(run([examplePath, '--verbose']).status, 1);
});

test('skill text stays within its budget and names every reason the checker can return', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.ok(Buffer.byteLength(skill) <= 6144, 'SKILL.md should stay under about 6 KB');
  for (const code of Object.values(REASONS)) assert.ok(skill.includes(code), `SKILL.md should explain ${code}`);
  const listed = (lead) => {
    const line = skill.split('\n').find((entry) => entry.includes(lead));
    return line.slice(line.indexOf(lead) + lead.length).split(/[.)]| in it/)[0].split(/, | or /).map((word) => word.trim()).filter(Boolean);
  };
  assert.deepEqual(listed('has a production word ('), [...PRODUCTION_WORDS], 'SKILL.md production words should match the checker');
  assert.deepEqual(listed('none of these words: '), [...NON_PRODUCTION_WORDS], 'SKILL.md non-production words should match the checker');
  assert.deepEqual(listed('whose name has '), [...TEMPORARY_WORDS], 'SKILL.md temporary words should match the checker');
  const contract = fs.readFileSync(path.join(skillRoot, 'references', 'backup-and-recovery.md'), 'utf8');
  for (const claim of ['configured', 'local copy made', 'uploaded', 'retrievable', 'database recoverable', 'fully recoverable', 'unlimited']) {
    assert.ok(contract.includes(claim), `backup contract should state the "${claim}" level`);
  }
});
