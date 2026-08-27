'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n5 = require('../scripts/toolkit-github-program-reconciler.cjs');
const a1 = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const repositoryId = '1'.repeat(64);

function parentState(overrides = {}) {
  return {
    kind: 'parent',
    tracker_version: 'v3',
    repository,
    parent_issue: 240,
    current_work: [{
      child_id: 'child-1',
      issue_number: 299,
      lifecycle: 'current',
      objective: 'N5 governance',
      implementation_pr: { number: 0, state: 'not_opened' },
    }],
    pending_work: [{
      child_id: 'child-2',
      issue_number: 320,
      lifecycle: 'pending',
      queue_order: 1,
      objective: 'Truthful review inventory',
    }],
    other_open_prs: [],
    terminal: [],
    deferred_findings: [],
    owner_detail: 'Owner bytes remain outside the queue projection.',
    ...overrides,
  };
}

function enabledA2() {
  return {
    resolveRepositoryIdentity: () => ({
      valid: true,
      repository_id: repositoryId,
      canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
    }),
    getRepositoryStatus: () => ({
      status: 'healthy',
      actionable: false,
      repository_id: repositoryId,
      canonical_remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
      capabilities: { 'repository.governance': { state: 'enabled' } },
    }),
  };
}

function authority() {
  return {
    authorize: ({ operation }) => ({
      decision: 'allow',
      operation_type: operation.type,
      operation_digest: a1.operationDigest(operation),
      target_digest: a1.targetDigest(operation),
    }),
  };
}

function githubAdapter(initialBody) {
  let current = initialBody;
  let writes = 0;
  return {
    getParent() {
      return { body: current, complete: true, revision: 'r0' };
    },
    updateParent(payload) {
      writes += 1;
      current = payload.body;
    },
    get values() {
      return { current, writes };
    },
  };
}

function runtime(github) {
  return n5.createRuntime({
    repository,
    github,
    a2: enabledA2(),
    authority_broker: authority(),
  });
}

function initialiseInput(state = parentState()) {
  return {
    repository,
    parent_issue: 240,
    target: { kind: n5.MUTATION_TARGET_KINDS.managed_parent_block, mode: 'create' },
    update: { type: 'set_parent_state', state },
    accepted_preview: true,
  };
}

function initialise(body, state = parentState()) {
  const github = githubAdapter(body);
  const result = runtime(github).initialise(initialiseInput(state));
  return { github, result };
}

function assertUncertainNoWrite(body, label, state = parentState()) {
  const { github, result } = initialise(body, state);
  assert.equal(result.code, 'PARENT_PARSE_UNCERTAIN', label);
  assert.equal(github.values.writes, 0, label);
  assert.equal(github.values.current, body, label);
}

function residue(kind, shape = 'begin') {
  const name = kind.toUpperCase();
  if (shape === 'end') return `<!-- AI-AGENT-TOOLKIT:N5-${name}:END -->`;
  if (shape === 'partial') return `<!-- AI-AGENT-TOOLKIT:N5-${name}:BEGIN`;
  return `<!-- AI-AGENT-TOOLKIT:N5-${name}:BEGIN v2 -->`;
}

function exactWithOutside(outside, position = 'after') {
  const exact = n5.renderManagedBlock('parent', parentState());
  return position === 'before'
    ? `${outside}\nordinary prefix\n${exact}ordinary suffix\n`
    : `ordinary prefix\n${exact}ordinary suffix\n${outside}\n`;
}

function legacyBody(version = n5.LEGACY_V0_VERSION) {
  return `legacy-prefix\n`
    + `## Queue authority\n`
    + `- Repository: ${repository}\n`
    + `- Parent issue: #240\n`
    + `- Legacy tracker version: ${version}\n`
    + `## Current execution\n`
    + `- Child: child-1 | Issue: #299 | Objective: N5 governance | PR: none\n`
    + `## Active queue\n`
    + `- Child: child-2 | Issue: #320 | Objective: Truthful review inventory | PR: none\n`
    + `## Completed or disposed\n`
    + `- Child: child-3 | Issue: #321 | Objective: Completed repair | PR: #350 | PR state: merged | Objective status: disposed | Outcome: Disposed without delivery\n`
    + `## Completion gate\n`
    + `- Gate: strict\n`
    + `## Governance ownership\n`
    + `- Owner: controller\n`
    + `## Mandatory parent reconciliation\n`
    + `- Required: yes\n`;
}

test('RUN-188 unsupported parent, child, PR and state residue before or after v3 is uncertain with zero writes', () => {
  for (const kind of ['parent', 'child', 'pr', 'state']) {
    for (const position of ['before', 'after']) {
      assertUncertainNoWrite(exactWithOutside(residue(kind), position), `${kind} ${position}`);
    }
  }
});

test('RUN-188 outside case-spacing and partial marker-family residue is uncertain with zero writes', () => {
  assertUncertainNoWrite(
    exactWithOutside('<!-- ai-agent-toolkit: n5 - child : begin v2 -->', 'after'),
    'case and spacing variant',
  );
  assertUncertainNoWrite(exactWithOutside(residue('pr', 'partial'), 'before'), 'partial PR begin');
  assertUncertainNoWrite(exactWithOutside(residue('parent', 'end'), 'after'), 'lone parent end');
});

test('RUN-188 ambiguity wins over same-state NOOP and conflicting-state scope rejection', () => {
  const body = exactWithOutside(residue('child'), 'after');
  const same = initialise(body, parentState());
  assert.equal(same.result.code, 'PARENT_PARSE_UNCERTAIN');
  assert.notEqual(same.result.code, 'N5_NOOP');
  assert.equal(same.github.values.writes, 0);

  const conflicting = initialise(body, parentState({ owner_detail: 'conflicting desired state' }));
  assert.equal(conflicting.result.code, 'PARENT_PARSE_UNCERTAIN');
  assert.notEqual(conflicting.result.code, 'N5_SCOPE_REJECTED');
  assert.equal(conflicting.github.values.writes, 0);
});

test('RUN-188 exact v3 alone and ordinary outside prose preserve existing behavior', () => {
  const exact = n5.renderManagedBlock('parent', parentState());
  const same = initialise(exact, parentState());
  assert.equal(same.result.code, 'N5_NOOP');
  assert.equal(same.github.values.writes, 0);

  const conflicting = initialise(exact, parentState({ owner_detail: 'conflicting desired state' }));
  assert.equal(conflicting.result.code, 'N5_SCOPE_REJECTED');
  assert.equal(conflicting.github.values.writes, 0);

  const prose = 'Owner notes discuss N5 parent governance, queue migration and review policy.\n';
  const body = `${prose}${exact}Owner notes after the managed block mention governance and migration.\n`;
  const withProse = initialise(body, parentState());
  assert.equal(withProse.result.code, 'N5_NOOP');
  assert.equal(withProse.github.values.writes, 0);
  assert.equal(withProse.github.values.current, body);
});

test('RUN-188 Run-187 unmanaged residue and exact legacy migration controls remain intact', () => {
  assertUncertainNoWrite('<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v2 -->');
  assertUncertainNoWrite('<!-- AI-AGENT-TOOLKIT:N5-PARENT:END -->');
  assertUncertainNoWrite('<!-- AI-AGENT-TOOLKIT:N5-STATE:BEGIN v2 -->\nopaque');

  const legacy = legacyBody();
  const initialised = initialise(legacy);
  assert.equal(initialised.result.code, 'N5_SCOPE_REJECTED');
  assert.equal(initialised.result.migration_required, true);
  assert.equal(initialised.result.source_version, n5.LEGACY_V0_VERSION);
  assert.equal(initialised.github.values.writes, 0);
  assert.equal(initialised.github.values.current, legacy);

  const parsed = n5.parseLegacyParent(legacy, { complete: true });
  assert.equal(parsed.ok, true);
  const github = githubAdapter(legacy);
  const migrated = runtime(github).migrate({
    repository,
    parent_issue: 240,
    target: {
      kind: n5.MUTATION_TARGET_KINDS.legacy_parent_block,
      source_version: n5.LEGACY_V0_VERSION,
      source_body_digest: n5.sha256(legacy),
    },
    update: { type: 'set_parent_state', state: parsed.state },
    accepted_preview: true,
  });
  assert.equal(migrated.code, 'N5_RECONCILED');
  assert.equal(github.values.writes, 1);
  assert.match(github.values.current, /AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3/);
});
