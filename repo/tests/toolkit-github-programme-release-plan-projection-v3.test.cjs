'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/toolkit-github-program-state-v5.cjs');
const programmeSurface = require('../scripts/toolkit-programme-surface-v1.cjs');
const Ajv2020 = require('ajv/dist/2020');

const SCHEMA_PATH = path.join(__dirname, '..', 'contracts', 'github-program-reconciler', 'v3-release-plan-projection-v1.schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const REPOSITORY = 'weijunswj/ai-agent-toolkit';
const CURRENT_OWNER = 'weijunswj';

function fixtureState() {
  const issueFor = (outcome, index) => outcome === 'C1' ? 435 : outcome === 'W2-A' ? 455 : 10000 + index;
  const children = programmeSurface.CURRENT_421_OUTCOMES.map((outcome, index) => {
    const issue = issueFor(outcome, index);
    const lifecycle = outcome === 'C1' ? 'CURRENT' : outcome === 'C2' ? 'COMPLETED' : 'QUEUED';
    const child = {
      boundaries: [`Keep the source-backed ${outcome} boundary.`],
      done_when: [`Complete the agreed ${outcome} outcome with its evidence.`],
      eli5: `The existing ${outcome} child remains the obligation owner.`,
      epochs: outcome === 'C2' ? [{
        evidence_ref: 'retired-milestone-evidence',
        gates: ['G2'],
        id: 'prior-milestone',
        lock: 'prior-milestone-lock',
        name: 'Prior milestone',
        purpose: 'Retain the retired milestone record.',
        state: 'RETIRED',
        status: 'RETIRED',
        terminal_disposition: 'REJECTED',
      }] : [],
      finality: { state: lifecycle === 'CURRENT' ? 'UNMERGED' : 'HELD' },
      issue,
      lifecycle,
      objective: `Deliver the existing ${outcome} outcome.`,
      order: index + 1,
      out_of_scope: [`Do not replace the existing ${outcome} child.`],
      pr_registry: [],
      scope: [`Preserve the ${outcome} acceptance obligation.`],
      summary: `${outcome} source-backed work.`,
      title: `${outcome}: existing programme child`,
    };
    return child;
  });
  const metadata = programmeSurface.CURRENT_421_OUTCOMES.map((outcome, index) => ({
    child_issue: issueFor(outcome, index),
    outcome_id: outcome,
    ...(outcome === 'W2-A' ? {
      priority: 'URGENT',
      planning_admission: 'G1_READ_ONLY_AUTHORIZED',
      implementation_admission: 'DEFERRED',
    } : {}),
    current_work: `${outcome} canonical checkpoint`,
  }));
  metadata.find((item) => item.outcome_id === 'C1').current_work = 'UAT pending';
  return {
    active_lanes: [{ child_issue: 435, gate: 'UAT', current_work: 'UAT pending' }],
    children,
    evidence_refs: [{
      id: 'retired-milestone-evidence',
      kind: 'WEB',
      reference: 'github:issue-comment:421:8800000002',
      summary: 'Source pointer for the retired milestone transition.',
    }],
    extensions: [{ schema: programmeSurface.METADATA_SCHEMA, outcomes: metadata }],
    historical_transitions: [{
      child_issue: children.find((child) => child.lifecycle === 'COMPLETED').issue,
      disposition: 'RETIRED',
      epoch_id: 'prior-milestone',
      evidence_ref: 'retired-milestone-evidence',
      gate: 'G2',
      id: 'retired-milestone-transition',
    }],
    parent: { goal: 'Keep the canonical Toolkit V3 programme obligations.', issue: 421, title: 'Toolkit V3 programme' },
    prs: [],
    repository: REPOSITORY,
    schema: 'toolkit.v3-programme-state.test',
  };
}

function categoryFor(outcome) {
  if (['C1', 'W2-A', 'C2'].includes(outcome)) return 'CORE';
  if (/^H[1-4]$/.test(outcome)) return 'HARDENING';
  return 'LATER';
}

function releasePlan(state, rendered) {
  const source = {
    repository: state.repository,
    parent_issue: state.parent.issue,
    body_sha256: rendered.read.body_sha256,
    canonical_sha256: rendered.canonical_sha256,
    revision: rendered.read.revision,
  };
  const coreMilestones = new Map([['C1', 1], ['W2-A', 1], ['C2', 2]]);
  const laterOrder = new Map();
  let nextLaterOrder = 0;
  const items = state.children.map((child) => {
    const outcome = programmeSurface.CURRENT_421_OUTCOMES[child.order - 1];
    const category = categoryFor(outcome);
    const milestoneOrder = category === 'CORE'
      ? coreMilestones.get(outcome)
      : category === 'HARDENING' ? 1 : (laterOrder.get(outcome) || (++nextLaterOrder && nextLaterOrder));
    if (category === 'LATER') laterOrder.set(outcome, milestoneOrder);
    return {
      child_issue: child.issue,
      category,
      milestone_id: `${category.toLowerCase()}-${milestoneOrder}`,
      milestone_order: milestoneOrder,
    };
  });
  return {
    schema: runtime.V3_RELEASE_PLAN_SCHEMA,
    version: 1,
    source,
    owner_decision_ref: {
      repository: REPOSITORY,
      issue_number: 421,
      comment_id: 8800000003,
      node_id: 'IC_kwDOv3-release-decision',
      author_login: CURRENT_OWNER,
      updated_at: '2026-10-12T10:12:13Z',
      body_sha256: '8'.repeat(64),
    },
    items,
  };
}

function previewFor(state, plan = null) {
  const rendered = runtime.humanSurfaceV2.render({
    source: { type: 'CANONICAL_STATE', state },
    target: { kind: 'parent' },
  });
  assert.equal(rendered.ok, true, JSON.stringify(rendered));
  const currentRead = rendered.read;
  const release = plan || releasePlan(state, rendered);
  return {
    rendered,
    plan: release,
    result: runtime.programmeV5.previewReleasePlan({
      current_read: currentRead,
      expected_current: {
        body_sha256: currentRead.body_sha256,
        canonical_sha256: rendered.canonical_sha256,
        revision: currentRead.revision,
      },
      release_plan: release,
    }),
  };
}

function expectFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(result.safe_for_provider_write, false);
  assert.equal(result.provider_mutation_authorised, false);
}

test('V3 release projection sorts categories and milestones independently of input row order', () => {
  const state = fixtureState();
  const first = previewFor(state);
  assert.equal(first.result.ok, true, first.result.code);
  const permutedPlan = structuredClone(first.plan);
  permutedPlan.items.reverse();
  const second = previewFor(state, permutedPlan);
  assert.equal(second.result.ok, true, second.result.code);

  const projection = first.result.projection;
  assert.deepEqual(projection.category_order, ['CORE', 'HARDENING', 'LATER']);
  assert.deepEqual(projection.categories.map((item) => item.category), ['CORE', 'HARDENING', 'LATER']);
  assert.deepEqual(second.result.projection, projection);
  assert.equal(second.result.projection_sha256, first.result.projection_sha256);
  assert.equal(validateSchema(projection), true, JSON.stringify(validateSchema.errors));
  assert.equal(first.result.safe_for_provider_write, false);
  assert.equal(first.result.provider_mutation_authorised, false);

  const projectedIssues = [
    ...projection.categories.flatMap((category) => category.obligations.map((item) => item.child_issue)),
    ...projection.completed_history.map((item) => item.child_issue),
  ];
  assert.equal(new Set(projectedIssues).size, projectedIssues.length);
  assert.deepEqual([...projectedIssues].sort((a, b) => a - b), state.children.map((item) => item.issue).sort((a, b) => a - b));
  for (const category of projection.categories) {
    const sorted = category.obligations.slice().sort((left, right) => left.milestone_order - right.milestone_order || left.child_issue - right.child_issue);
    assert.deepEqual(category.obligations, sorted);
  }
});

test('release plan preserves canonical child obligations and owner decision provenance', () => {
  const state = fixtureState();
  const { result, plan } = previewFor(state);
  assert.equal(result.ok, true, result.code);
  const projection = result.projection;
  const current = projection.categories.flatMap((item) => item.obligations).find((item) => item.child_issue === 435);
  assert.deepEqual(current.canonical_child, state.children.find((item) => item.issue === 435));
  assert.deepEqual(current.canonical_child.scope, ['Preserve the C1 acceptance obligation.']);
  const completed = projection.completed_history.find((item) => item.child_issue === state.children.find((item) => item.lifecycle === 'COMPLETED').issue);
  assert.deepEqual(completed.canonical_child, state.children.find((item) => item.issue === completed.child_issue));
  assert.deepEqual(projection.historical.retired_transitions, state.historical_transitions);
  assert.deepEqual(projection.historical.canonical_evidence_refs, state.evidence_refs);
  assert.deepEqual(projection.owner_decision_ref, plan.owner_decision_ref);
});

test('current checkpoint and pending UAT remain canonical lifecycle facts, not completion claims', () => {
  const state = fixtureState();
  const { result, plan } = previewFor(state);
  assert.equal(result.ok, true, result.code);
  const current = result.projection.categories.flatMap((item) => item.obligations).find((item) => item.child_issue === 435);
  assert.equal(current.lifecycle, 'CURRENT');
  assert.deepEqual(current.current_checkpoint, { gate: 'UAT', work: 'UAT pending' });
  assert.equal(result.projection.completed_history.some((item) => item.child_issue === 435), false);

  const forged = structuredClone(plan);
  forged.items[0].lifecycle = 'COMPLETED';
  expectFailure(previewFor(state, forged).result, 'RELEASE_PLAN_ITEM_INVALID');
  const accepted = structuredClone(plan);
  accepted.items[0].accepted = true;
  expectFailure(previewFor(state, accepted).result, 'RELEASE_PLAN_ITEM_INVALID');
});

test('duplicate or missing child mappings fail closed', () => {
  const state = fixtureState();
  const baseline = previewFor(state);

  const duplicate = structuredClone(baseline.plan);
  duplicate.items[duplicate.items.length - 1] = structuredClone(duplicate.items[0]);
  expectFailure(previewFor(state, duplicate).result, 'RELEASE_PLAN_DUPLICATE_CHILD_MAPPING');

  const missing = structuredClone(baseline.plan);
  missing.items.pop();
  expectFailure(previewFor(state, missing).result, 'RELEASE_PLAN_CHILD_MAPPING_MISSING');
});

test('expected-current and source bindings reject stale projection inputs', () => {
  const state = fixtureState();
  const baseline = previewFor(state);
  const currentRead = baseline.rendered.read;
  const baseInput = {
    current_read: currentRead,
    expected_current: {
      body_sha256: currentRead.body_sha256,
      canonical_sha256: baseline.rendered.canonical_sha256,
      revision: currentRead.revision,
    },
    release_plan: structuredClone(baseline.plan),
  };
  expectFailure(runtime.programmeV5.previewReleasePlan({
    ...baseInput,
    expected_current: { ...baseInput.expected_current, body_sha256: '9'.repeat(64) },
  }), 'RELEASE_PLAN_EXPECTED_CURRENT_MISMATCH');
  const staleSource = structuredClone(baseInput);
  staleSource.release_plan.source.canonical_sha256 = '9'.repeat(64);
  expectFailure(runtime.programmeV5.previewReleasePlan(staleSource), 'RELEASE_PLAN_SOURCE_MISMATCH');
});

test('release plan contract rejects caller-supplied lifecycle and acceptance fields', () => {
  const state = fixtureState();
  const { plan, result } = previewFor(state);
  assert.equal(validateSchema(plan), true, JSON.stringify(validateSchema.errors));
  assert.equal(validateSchema(result.projection), true, JSON.stringify(validateSchema.errors));
  const forged = structuredClone(plan);
  forged.items[0].status = 'ACCEPTED';
  assert.equal(validateSchema(forged), false);
});
