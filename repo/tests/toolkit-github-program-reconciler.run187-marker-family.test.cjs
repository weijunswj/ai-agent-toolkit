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

function assertUncertainNoWrite(body, label) {
  const { github, result } = initialise(body);
  assert.equal(result.code, 'PARENT_PARSE_UNCERTAIN', label);
  assert.equal(github.values.writes, 0, label);
  assert.equal(github.values.current, body, label);
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

test('RUN-187 unsupported and partial N5 marker-family residue is initialise-uncertain with zero writes', () => {
  const cases = [
    ['lone unsupported parent begin', '<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v2 -->'],
    ['unsupported parent version plus opaque text', '<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v7 -->\nopaque owner text\n'],
    ['lone parent end residue', '<!-- AI-AGENT-TOOLKIT:N5-PARENT:END -->'],
    ['partial parent begin', '<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN'],
    ['unsupported child residue', `owner\n<!-- AI-AGENT-TOOLKIT:N5-CHILD:BEGIN v2 -->\nopaque\n`],
    ['unsupported PR residue', `owner\n<!-- AI-AGENT-TOOLKIT:N5-PR:BEGIN v4 -->\nopaque\n`],
    ['unsupported state residue', `owner\n<!-- AI-AGENT-TOOLKIT:N5-STATE:BEGIN v2 -->\nopaque\n`],
    ['mixed current and unsupported marker residue', '<!-- AI-AGENT-TOOLKIT:N5-STATE:BEGIN v1 -->\n<!-- AI-AGENT-TOOLKIT:N5-PR:BEGIN v9 -->'],
    ['case and spacing variant residue', '<!-- ai-agent-toolkit: n5 - parent : begin v2 -->'],
  ];
  for (const [label, body] of cases) assertUncertainNoWrite(body, label);
});

test('RUN-187 exact current v3 controls preserve truthful NOOP and scope rejection', () => {
  const exact = n5.renderManagedBlock('parent', parentState());
  const same = initialise(exact, parentState());
  assert.equal(same.result.code, 'N5_NOOP');
  assert.equal(same.github.values.writes, 0);
  assert.equal(same.github.values.current, exact);

  const conflicting = initialise(exact, parentState({ owner_detail: 'conflicting desired state' }));
  assert.equal(conflicting.result.code, 'N5_SCOPE_REJECTED');
  assert.equal(conflicting.github.values.writes, 0);
  assert.equal(conflicting.github.values.current, exact);
});

test('RUN-187 exact legacy remains initialise migrate-only and valid migrate remains strict', () => {
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

test('RUN-187 unrelated owner prose and generic N5 prose remain eligible and preserve bytes', () => {
  const ownerProse = 'Owner notes discuss queue governance before the N5 parent migration.\nSecond owner line.\n';
  const first = initialise(ownerProse);
  assert.equal(first.result.code, 'N5_RECONCILED');
  assert.equal(first.github.values.writes, 1);
  assert.equal(first.github.values.current.slice(0, ownerProse.length), ownerProse);
  assert.equal(first.github.values.current.indexOf('Second owner line.'), ownerProse.indexOf('Second owner line.'));

  const generic = 'N5 parent governance discusses queue ownership and migration, but contains no managed-comment marker namespace.\n';
  const second = initialise(generic);
  assert.equal(second.result.code, 'N5_RECONCILED');
  assert.equal(second.github.values.writes, 1);
  assert.equal(second.github.values.current.slice(0, generic.length), generic);
});
