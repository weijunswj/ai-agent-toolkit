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
const { PLAN_SCHEMA, REASONS, TRIGGERS, checkPlan, planHash } = require(checkerPath);

const NOW = Date.parse('2026-10-25T00:00:00Z');
const FUTURE = '2026-12-31';
const PAST = '2026-10-01';

function target(id, environment, providerEnvironment = environment) {
  return { id, kind: 'app', provider: 'platform', environment, provider_environment: providerEnvironment };
}

function resource(id, nameEnvironment, providerEnvironment = nameEnvironment, extra = {}) {
  return { id, kind: 'database', provider: 'store', name_environment: nameEnvironment, provider_environment: providerEnvironment, ...extra };
}

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
    operation: { action: 'deploy', environment, targets: ['app'] },
    targets: [target('app', environment)],
    resources: [resource('db', environment), resource('bucket', environment)],
    bindings: [write('app', 'db'), write('app', 'bucket')],
    authority: [allow('app', 'deploy', environment)],
    exceptions: []
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
      plan: plan({ environment: 'restore', resources: [resource('db', 'restore', 'restore', partial), resource('bucket', 'restore')] }),
      verdict: 'HOLD',
      codes: [REASONS.TEMPORARY_RESOURCE_INCOMPLETE]
    };
  }),
  {
    name: 'temporary resource whose end date has passed',
    plan: plan({ environment: 'restore', resources: [resource('db', 'restore', 'restore', { ...temporaryComplete, end_date: PAST }), resource('bucket', 'restore')] }),
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
      operation: { action: 'create', environment: 'alpha', targets: ['app'], actions: [{ resource: 'app', action: 'deploy' }, { resource: 'bucket', action: 'create' }] }
    }),
    verdict: 'HOLD',
    codes: [REASONS.NOT_AUTHORISED]
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

test('M2: a merge that does not say what it sets off is held', () => {
  const result = checkPlan(mergePlan(undefined), { now: NOW });
  assert.equal(result.verdict, 'HOLD');
  assert.deepEqual(codes(result), [REASONS.DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED]);
});

test('routes: fallback rules', async (t) => {
  const first = { route: 'mcp', target: 'app', privilege: 'deploy', effect: 'deploy' };
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
    ...['target', 'privilege', 'effect'].map((key) => ({
      name: `fallback that changes ${key}`,
      routes: [{ ...first, outcome: 'failed_before_effect' }, { ...first, route: 'browser', [key]: 'other', outcome: 'selected', pre_approved: true }],
      verdict: 'HOLD',
      codes: [REASONS.ROUTE_FALLBACK_REFUSED]
    })),
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
    { name: 'resource with no provider read-back', plan: plan({ resources: [{ id: 'db', name_environment: 'alpha' }, resource('bucket', 'alpha')] }), code: REASONS.PLAN_INVALID },
    { name: 'unknown trigger', plan: plan({ downstream: { trigger: 'SOMETIMES' } }), code: REASONS.PLAN_INVALID },
    { name: 'bad binding access', plan: plan({ bindings: [{ target: 'app', resource: 'db', access: 'admin' }] }), code: REASONS.PLAN_INVALID },
    { name: 'token-shaped value', plan: plan({ note: `ghp_${'a'.repeat(36)}` }), code: REASONS.SECRET_IN_PLAN },
    { name: 'URL with a password', plan: plan({ note: 'postgres://user:hunter2@db.example.test/app' }), code: REASONS.SECRET_IN_PLAN },
    { name: 'value under a secret-named key', plan: plan({ api_token: 'plain-value-here' }), code: REASONS.SECRET_IN_PLAN }
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
  assert.equal(JSON.parse(example.stdout).verdict, 'ALLOW');

  const held = run(['--stdin', '--now', '2026-10-25'], JSON.stringify(plan({ authority: [] })));
  assert.equal(held.status, 2);
  assert.equal(JSON.parse(held.stdout).verdict, 'HOLD');

  assert.equal(run([]).status, 1);
  assert.equal(run(['--stdin'], 'not json').status, 1);
  assert.equal(run([examplePath, '--now', 'yesterday']).status, 1);
});

test('skill text stays within its budget and names every reason the checker can return', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.ok(Buffer.byteLength(skill) <= 6144, 'SKILL.md should stay under about 6 KB');
  for (const code of Object.values(REASONS)) assert.ok(skill.includes(code), `SKILL.md should explain ${code}`);
  const contract = fs.readFileSync(path.join(skillRoot, 'references', 'backup-and-recovery.md'), 'utf8');
  for (const claim of ['configured', 'local copy made', 'uploaded', 'retrievable', 'database recoverable', 'fully recoverable', 'unlimited']) {
    assert.ok(contract.includes(claim), `backup contract should state the "${claim}" level`);
  }
});
