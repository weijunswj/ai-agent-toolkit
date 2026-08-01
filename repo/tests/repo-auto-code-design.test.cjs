'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleRoot = path.join(repoRoot, '_projects', 'development', 'repo-auto-code');
const mainRoot = path.join(moduleRoot, '_main');
const fixtureRoot = path.join(mainRoot, 'fixtures');
const templateRoot = path.join(mainRoot, 'templates');

const expectedFixtureFiles = [
  'invalid-body-comment-disagreement.json',
  'invalid-duplicate-claims.json',
  'invalid-duplicate-packets.json',
  'invalid-final-live-prompt.json',
  'invalid-incomplete-teardown.json',
  'invalid-malformed-agents-block.json',
  'invalid-missing-provider-routing.json',
  'invalid-missing-skill.json',
  'invalid-non-atomic-claim.json',
  'invalid-partial-publication.json',
  'invalid-secret-prompt.json',
  'invalid-stale-g4.json',
  'valid-existing-pr-adoption.json',
  'valid-first-run.json',
  'valid-parallel-prs.json',
  'valid-processed-prompt.json',
  'valid-same-pr-fast-forward.json'
];

const routingProfiles = [
  'Scheduled dispatcher',
  'G1/G2 support',
  'Normal G3 implementation/amendment',
  'Named G3 escalation',
  'Fresh G4',
  'Exceptional final review'
];

const mandatedDash = JSON.parse('"\\u2014"');
const protocolDashEscape = String.fromCharCode(92) + 'u2014';
const mandatedClaimUnavailable = `BLOCKED ${mandatedDash} ATOMIC CLAIM CAPABILITY UNAVAILABLE`;
const processedPromptMarker = `[ REDACTED ${mandatedDash} PROCESSED ]`;
const protocolClaimUnavailable = `BLOCKED ${protocolDashEscape} ATOMIC CLAIM CAPABILITY UNAVAILABLE`;
const protocolProcessedMarker = `[ REDACTED ${protocolDashEscape} PROCESSED ]`;

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readModule(relativePath) {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readModule(relativePath));
}

function count(text, value) {
  return (text.match(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

function sectionAfterHeading(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n### ', start + heading.length);
  return text.slice(start, next === -1 ? text.length : next);
}

function assertRoutingProfiles(prompt, label) {
  for (const profile of routingProfiles) {
    const section = sectionAfterHeading(prompt, `### Routing profile: ${profile}`);
    assert.match(section, /^- Provider:\s*\S.+$/m, `${label}: ${profile} Provider`);
    assert.match(section, /^- Model:\s*\S.+$/m, `${label}: ${profile} Model`);
    assert.match(section, /^- Reasoning:\s*\S.+$/m, `${label}: ${profile} Reasoning`);
  }
  assert.match(sectionAfterHeading(prompt, '### Routing profile: Normal G3 implementation/amendment'), /Sol-equivalent:/);
  assert.match(sectionAfterHeading(prompt, '### Routing profile: Named G3 escalation'), /Permitted reasons:/);
  assert.match(sectionAfterHeading(prompt, '### Routing profile: Exceptional final review'), /Conditions:/);
  assert.match(prompt, /cannot substitute|Do not substitute|never silently replaced/i, `${label}: routing prohibition`);
}

function extractCodePacket(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing packet start marker ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing packet end marker ${endMarker}`);
  return text.slice(start, end + endMarker.length);
}

function assertPacketGrammar(protocol) {
  const ote = extractCodePacket(
    protocol,
    '[ ORCHESTRATOR TO EXECUTOR: START ]',
    '[ ORCHESTRATOR TO EXECUTOR: END ]'
  );
  const eto = extractCodePacket(
    protocol,
    '[ EXECUTOR TO ORCHESTRATOR: START ]',
    '[ EXECUTOR TO ORCHESTRATOR: END ]'
  );

  for (const field of [
    'Packet ID:',
    'Controller Run ID:',
    'Current gate / Design Lock:',
    'Starting authority:',
    'Assigned provider:',
    'Assigned model:',
    'Assigned reasoning:',
    'Assigned role:'
  ]) {
    assert.equal(count(ote, field), 1, `OTE field count for ${field}`);
  }
  for (const field of [
    'Responds to Packet ID:',
    'Executor Run ID:',
    'Prompt starting head:',
    'Adopted starting head:',
    'Final head:',
    'Commit and validation:',
    'Blockers:',
    'Secret-exposure audit:',
    '**PRIVATE USER FOLLOW-UP REQUIRED**',
    'Reason:',
    'What the web controller should ask:',
    'Acceptable safe response:',
    'Do not provide:'
  ]) {
    assert.equal(count(eto, field), 1, `ETO field count for ${field}`);
  }
  assert.match(ote, /^\[ ORCHESTRATOR TO EXECUTOR: START \]/);
  assert.match(ote, /\[ ORCHESTRATOR TO EXECUTOR: END \]$/);
  assert.match(eto, /^\[ EXECUTOR TO ORCHESTRATOR: START \]/);
  assert.match(eto, /\[ EXECUTOR TO ORCHESTRATOR: END \]$/);
  assert.ok(protocol.indexOf('[ ORCHESTRATOR TO EXECUTOR: START ]') < protocol.indexOf('[ ORCHESTRATOR TO EXECUTOR: END ]'));
  assert.ok(protocol.indexOf('[ EXECUTOR TO ORCHESTRATOR: START ]') < protocol.indexOf('[ EXECUTOR TO ORCHESTRATOR: END ]'));
}

function assertManagedBlock(template) {
  const begin = '<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:BEGIN REPO-AUTO-CODE v1 -->';
  const end = '<!-- AI-AGENT-TOOLKIT:_projects/development/repo-auto-code/_main/templates/AGENTS.auto-code.managed.md:END REPO-AUTO-CODE -->';
  assert.equal(count(template, begin), 1);
  assert.equal(count(template, end), 1);
  assert.doesNotMatch(template, /END REPO-AUTO-CODE v1/);
  assert.ok(template.indexOf(begin) < template.indexOf(end));
  assert.match(template, /State: `ENABLED`.*`DISABLED`/);
  assert.match(template, /Protocol version: `1`/);
  assert.match(template, /Canonical skill: `repo-auto-code`/);
  assert.match(template, /Canonical rolling parent:/);
  assert.match(template, /\[ ORCHESTRATOR TO EXECUTOR: START \]/);
  assert.match(template, /\[ ORCHESTRATOR TO EXECUTOR: END \]/);
  assert.match(template, /\[ EXECUTOR TO ORCHESTRATOR: START \]/);
  assert.match(template, /\[ EXECUTOR TO ORCHESTRATOR: END \]/);
  assert.match(template, /Fresh-chat reconstruction/);
  assert.match(template, /PR enrolment/);
  assert.match(template, /Web-controller ownership/);
  assert.match(template, /Public-safe GitHub/);
  assert.match(template, /AUTO_CODE_SETUP_INVALID/);
  assert.doesNotMatch(template, /Packet ID:/);
}

function assertPublicationContract(protocol) {
  const draft = protocol.indexOf('status `DRAFT`');
  const binding = protocol.indexOf('Bind the same Packet ID');
  const reread = protocol.indexOf('Re-read the parent, child, and PR bodies');
  const ready = protocol.indexOf('Change the canonical child comment to `READY_EXECUTOR` last');
  const finalReread = protocol.indexOf('Re-read the child comment and every authority surface');
  assert.ok(draft >= 0 && draft < binding);
  assert.ok(binding < reread && reread < ready && ready < finalReread);
  assert.match(protocol, /`DRAFT` is non-actionable/);
  assert.match(protocol, /PR pointer is discoverability only/);
  assert.match(protocol, /Partial parent\/child\/PR publication/i);
  assert.ok(protocol.includes(protocolClaimUnavailable));
  assert.ok(protocol.includes(protocolProcessedMarker));
  for (const line of [
    '[ AUTO-CODE ENROLMENT: START ]',
    'Protocol version: 1',
    'Surface: PARENT|CHILD|PR',
    'Repository: <canonical owner/name>',
    'Parent issue: #<number>',
    'Child issue: #<number>',
    'PR: #<number>',
    'Packet ID: OTE-<unique>|NONE',
    'Turn: CONTROLLER|EXECUTOR|NONE',
    'Enrolment: ENROLLED',
    '[ AUTO-CODE ENROLMENT: END ]'
  ]) {
    assert.match(protocol, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

function assertClaimContract(protocol) {
  assert.match(protocol, /atomic packet-scoped, lease-bound create-if-absent claim primitive/);
  assert.match(protocol, /leaseId:/);
  assert.match(protocol, /leaseExpiresAt:/);
  assert.match(protocol, /GitHub comments, comment IDs, timestamps, lowest-comment-ID rules/);
  assert.match(protocol, /createIfAbsent\(input\)/);
  assert.match(protocol, /readBack\(claimId\)/);
  assert.match(protocol, /must not move the implementation PR head/);
  assert.match(protocol, /Two successful claims for one packet are impossible/);
  assert.match(protocol, /sole claimant/);
  assert.match(protocol, /created: false/);
  assert.match(protocol, /L1 verifies.*never calls `createIfAbsent` again/);
  assert.match(protocol, /read-back identity, head, lease, or expiry mismatch/);
  assert.ok(protocol.includes(protocolClaimUnavailable));
  assert.match(protocol, /Lease expiry never grants automatic takeover/);
  assert.match(protocol, /controller may retire or supersede/);
}

function looksSecretBearing(text) {
  return [
    /\b(?:ghp|github_pat|sk_live|AKIA)[A-Za-z0-9_:-]{8,}/i,
    /(?:authorization|x-api-key|cookie)\s*:/i,
    /\bbearer\s+(?!\[REDACTED\])\S+/i,
    /\b(?:password|secret|token)\s*[:=]\s*(?!\[REDACTED\]|(?:true|false|present|absent|none)\b)\S+/i,
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----/i
  ].some((pattern) => pattern.test(text));
}

function parseBindingBlock(bodyLines, expectedSurface) {
  assert.deepEqual(bodyLines, [
    '[ AUTO-CODE ENROLMENT: START ]',
    'Protocol version: 1',
    `Surface: ${expectedSurface}`,
    'Repository: weijunswj/ai-agent-toolkit',
    'Parent issue: #240',
    'Child issue: #329',
    'PR: #501',
    'Packet ID: NONE',
    'Turn: CONTROLLER',
    'Enrolment: ENROLLED',
    '[ AUTO-CODE ENROLMENT: END ]'
  ], `exact ${expectedSurface} binding grammar`);
  return {
    protocolVersion: bodyLines[1],
    surface: bodyLines[2],
    repository: bodyLines[3],
    parent: bodyLines[4],
    child: bodyLines[5],
    pr: bodyLines[6],
    packet: bodyLines[7],
    turn: bodyLines[8],
    enrolment: bodyLines[9]
  };
}

function assertEnrolmentAgreement(enrolment) {
  assert.ok(enrolment && enrolment.parent && enrolment.child && enrolment.pr);
  const surfaces = [enrolment.parent, enrolment.child, enrolment.pr];
  const parsed = surfaces.map((surface) => {
    assert.equal(surface.enrolled, true);
    assert.ok(Array.isArray(surface.bodyLines));
    return parseBindingBlock(surface.bodyLines, surface.surface);
  });
  for (const key of ['protocolVersion', 'repository', 'parent', 'child', 'pr', 'packet', 'turn', 'enrolment']) {
    assert.equal(new Set(parsed.map((surface) => surface[key])).size, 1, `enrolment ${key} agrees`);
  }
  assert.deepEqual(parsed.map((surface) => surface.surface), ['Surface: PARENT', 'Surface: CHILD', 'Surface: PR']);
}

function rejected(status) {
  return { accepted: false, status, mutationProhibited: true };
}

function evaluateFixture(fixture) {
  const state = fixture.state;
  switch (fixture.scenario) {
    case 'first_run':
      assert.equal(state.repository.exact, true);
      assert.equal(state.consent, true);
      assert.equal(state.skill.available, true);
      assert.equal(state.skill.inspectable, true);
      assert.equal(state.managedBlock.status, 'ABSENT');
      assert.equal(state.schedules.controller, 'absent');
      assert.equal(state.schedules.executor, 'absent');
      assert.equal(state.packet.status, 'NONE');
      assert.equal(fixture.expected.mutation, 'safe_preparation_only');
      return { accepted: true, turn: 'CONTROLLER_TURN' };

    case 'existing_pr_adoption':
      assert.equal(state.pr.classification, 'ADOPTION_ELIGIBLE');
      assert.equal(state.pr.completeDiffInspected, true);
      assert.equal(state.pr.completeCommitsInspected, true);
      assert.equal(state.pr.reviewsInspected, true);
      assert.equal(state.pr.designLockApplies, true);
      assert.equal(state.pr.forbiddenOverlap, false);
      assertEnrolmentAgreement(state.enrolment);
      assert.equal(state.schedules.controller, 'absent');
      assert.equal(state.schedules.executor, 'absent');
      assert.equal(state.claim.atomic, true);
      return { accepted: true, classification: 'ADOPTION_ELIGIBLE', turn: 'CONTROLLER_TURN' };

    case 'parallel_prs':
      assert.equal(state.capacity, 1);
      assert.equal(state.parentOrder[0], fixture.expected.selectedChild);
      assert.equal(state.independentPacketState, true);
      assert.equal(state.independentClaimState, true);
      assert.equal(state.recentPrOrder[0], '#700');
      assert.equal(fixture.expected.selection, 'parent_checklist_order');
      return { accepted: true, capacity: 1, selectedChild: state.parentOrder[0], selection: 'parent_checklist_order' };

    case 'same_pr_fast_forward':
      assert.equal(state.completeInterveningInspection, true);
      assert.equal(state.lineByLineDiffInspection, true);
      assert.equal(state.assignmentStillApplies, true);
      assert.equal(state.compatible, true);
      assert.notEqual(state.baseHead, state.liveHead);
      assert.equal(state.priorG4.reusable, false);
      return { accepted: true, adoptedHead: state.liveHead, freshG4Required: true };

    case 'processed_prompt':
      assert.equal(state.prompt.live, false);
      assert.equal(state.prompt.processed, true);
      assert.equal(state.prompt.payload, processedPromptMarker);
      for (const field of ['packetId', 'executorRunId', 'resultingHead', 'reconciliationRef']) {
        assert.ok(state.durableAudit[field], `durable field ${field}`);
      }
      assert.equal(state.executorEvidenceRetained, true);
      assert.equal(state.secretContext.namesOnly[0], 'GITHUB_TOKEN');
      assert.equal(state.secretContext.presence, 'present');
      assert.equal(state.secretContext.value, '[REDACTED]');
      assert.equal(state.pendingResult, false);
      return { accepted: true, completion: 'allowed_after_reconciliation' };

    case 'missing_skill':
      assert.equal(state.skill.available, false);
      assert.equal(state.skill.inspectable, false);
      assert.equal(fixture.expected.status, 'AUTO_CODE_SETUP_INVALID');
      return rejected('AUTO_CODE_SETUP_INVALID');

    case 'malformed_agents_block':
      assert.equal(state.managedBlock.end, 'missing');
      assert.equal(fixture.expected.status, 'AUTO_CODE_SETUP_INVALID');
      return rejected('AUTO_CODE_SETUP_INVALID');

    case 'missing_provider_routing':
      assert.equal(state.profiles.some((profile) => !profile.Reasoning), true);
      assert.equal(fixture.expected.status, 'BLOCKED_MISSING_WORKER_PROFILE');
      return rejected('BLOCKED_MISSING_WORKER_PROFILE');

    case 'partial_publication':
      assert.equal(state.publication.status, 'READY_EXECUTOR');
      assert.equal(state.publication.draftPosted, true);
      assert.equal(state.publication.parentBinding && state.publication.childBinding && state.publication.prBinding, false);
      assert.equal(state.publication.bodiesRereadBeforeReady, false);
      assert.equal(state.publication.readySetLast, false);
      return rejected('DRAFT_BINDING_INCOMPLETE');

    case 'duplicate_packets':
      assert.notEqual(new Set(state.livePacketIds).size, state.livePacketIds.length);
      assert.equal(state.canonicalCount, 2);
      return rejected('DUPLICATE_PACKET');

    case 'duplicate_claims':
      assert.equal(state.claim.atomic, true);
      assert.equal(state.claim.winnerCount, 2);
      assert.equal(state.claim.readBackExact, false);
      return rejected('DUPLICATE_CLAIM');

    case 'non_atomic_claim':
      assert.equal(state.claim.atomic, false);
      assert.ok(state.claim.leaseTimestamp);
      assert.equal(state.claim.lowestCommentIdRule, true);
      assert.notEqual(state.claim.capability, 'create-if-absent');
      return rejected(mandatedClaimUnavailable);

    case 'body_comment_disagreement': {
      const ids = Object.values(state.surfaces);
      assert.notEqual(new Set(ids).size, 1);
      return rejected('AUTHORITY_DISAGREEMENT');
    }

    case 'stale_g4':
      assert.notEqual(state.g4.reviewedHead, state.g4.currentHead);
      assert.equal(state.g4.headMoved, true);
      return rejected('STALE_G4');

    case 'secret_prompt': {
      assert.equal(looksSecretBearing(state.promptContent), true);
      const safe = `Secret name: ${state.secretName}; presence: ${state.presence}; value: ${state.redactedValue}`;
      assert.equal(looksSecretBearing(safe), false);
      return rejected('SECRET_EXPOSURE_DETECTED');
    }

    case 'final_live_prompt':
      assert.equal(state.completionRequested, true);
      assert.equal(state.prompt.live, true);
      assert.equal(state.prompt.processed, false);
      return rejected('LIVE_PROMPT_REMAINS');

    case 'incomplete_teardown':
      assert.equal(state.completionRequested, true);
      assert.equal(state.userExplicitlyRequestedRemoval, true);
      assert.equal(state.schedules.controller.status, 'removed');
      assert.notEqual(state.schedules.executor.status, 'removed');
      assert.equal(state.otherRepositoryAffected, false);
      return rejected('INCOMPLETE_SCHEDULER_TEARDOWN');

    default:
      assert.fail(`unhandled fixture scenario: ${fixture.scenario}`);
  }
}

test('repo-auto-code design has an inert source-only module contract', () => {
  const manifest = readJson('toolkit.project.json');
  const lock = readJson('SOURCE-LOCK.json');
  assert.equal(manifest.id, 'development.repo-auto-code');
  assert.equal(manifest.surface.publish_as, 'source_only');
  assert.equal(manifest.surface.skill.status, 'not_applicable');
  assert.equal(manifest.surface.mcp.status, 'not_applicable');
  assert.deepEqual(manifest.outputs, []);
  assert.deepEqual(manifest.writes.allowed, []);
  assert.equal(manifest.requires_approval, true);
  assert.equal(manifest.run_commands_by_default, false);
  assert.equal(manifest.live_actions, 'explicit_confirmation_only');
  assert.equal(manifest.ci_live_actions, false);
  assert.deepEqual(lock.files, []);
  assert.equal(lock.source_repo, 'weijunswj/ai-agent-toolkit');
  assert.equal(lock.source_commit, '931ebff00dd1473a5b28f104a6a566742547c594');
  assert.match(lock.provenance_notes, /first-party|First-party/);
  assert.match(lock.provenance_notes, /empty files array/);

  assert.equal(fs.existsSync(path.join(repoRoot, 'skills', 'repo-auto-code')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'repo-auto-code.yml')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'claim-refs')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'scheduled-tasks')), false);
  assert.doesNotMatch(read('AGENTS.md'), /AI-AGENT-TOOLKIT:.*REPO-AUTO-CODE/);
  assert.match(readModule('README.md'), /does not install or activate a skill, managed `AGENTS\.md` block, GitHub workflow, scheduler, claim mechanism, PR enrolment, or runtime controller/i);
});

test('managed block and both packet grammars are exact and complete', () => {
  const managed = readModule('_main/templates/AGENTS.auto-code.managed.md');
  const protocol = readModule('_main/protocol.md');
  assertManagedBlock(managed);
  assertPacketGrammar(protocol);
  assertPublicationContract(protocol);
  assertClaimContract(protocol);
});

test('both scheduled prompts require every routing field and preserve hierarchy boundaries', () => {
  const controller = readModule('_main/templates/web-controller-scheduled-task.prompt.md');
  const executor = readModule('_main/templates/executor-scheduled-task.prompt.md');
  assertRoutingProfiles(controller, 'controller prompt');
  assertRoutingProfiles(executor, 'executor prompt');
  for (const prompt of [controller, executor]) {
    assert.match(prompt, /L0/);
    assert.match(prompt, /L1/);
    assert.match(prompt, /L2/);
    assert.match(prompt, /cannot delegate|cannot.*nest/i);
    assert.match(prompt, /review mutation|review state/i);
    assert.match(prompt, /manual.*scheduled task|manually create.*scheduled task/i);
    assert.match(prompt, /BLOCKED \\u2014 ATOMIC CLAIM CAPABILITY UNAVAILABLE/);
    assert.match(prompt, /\[ REDACTED \\u2014 PROCESSED \]/);
    assert.doesNotMatch(prompt, /ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----/i);
    assert.equal(looksSecretBearing(prompt), false);
    assert.ok([...prompt].every((character) => character.codePointAt(0) < 128), 'agent prompt uses ASCII punctuation');
  }
});

test('failure matrix has required evidence, repair, and lane-isolation columns', () => {
  const matrix = readModule('_main/failure-matrix.md');
  for (const column of ['Detection evidence', 'Mutation prohibited', 'Required state transition', 'Exact user/controller repair action', 'Unrelated lanes']) {
    assert.match(matrix, new RegExp(`\\| ${column} \\|`));
  }
  for (const id of [
    'F-001', 'F-002', 'F-003', 'F-004', 'F-005', 'F-006', 'F-007', 'F-008', 'F-009', 'F-010',
    'F-011', 'F-012', 'F-013', 'F-014', 'F-015', 'F-016', 'F-017', 'F-018', 'F-019', 'F-020',
    'F-021', 'F-022', 'F-023', 'F-024', 'F-025', 'F-026', 'F-027', 'F-028', 'F-029', 'F-030',
    'F-031', 'F-032', 'F-033', 'F-034', 'F-035', 'F-036', 'F-037', 'F-038', 'F-039', 'F-040', 'F-041'
  ]) {
    assert.match(matrix, new RegExp(`\\| ${id} \\|`), `failure row ${id}`);
  }
  assert.match(matrix, /\| F-034 \|[\s\S]*?\| `HELD` \|/);
  assert.match(matrix, /\| F-041 \|[\s\S]*?\| `HELD` \|/);
});

test('controller prompt location and lifecycle state boundaries are explicit', () => {
  const architecture = readModule('_main/architecture.md');
  const lifecycle = readModule('_main/state-machine.md');
  assert.match(architecture, /Manual controller prompts[\s\S]*active web conversation/);
  assert.match(architecture, /not copied into GitHub bodies or comments or into scheduled-task payloads/);
  for (const label of ['SETUP', 'PREPARED', 'SCHEDULED', 'ENROLLED', 'CLAIMED', 'RUNNING', 'ACCEPTED', 'COMPLETE']) {
    assert.match(lifecycle, new RegExp('`' + label + '`'));
  }
  assert.match(lifecycle, /prepared prompts alone never set this state/);
  assert.match(lifecycle, /A trusted atomic read-back verifies one capability-issued lease/);
  assert.match(lifecycle, /merge and teardown remain separate/);
});

test('every authorised fixture is discovered, unique, executed, and behaviorally asserted', () => {
  const discovered = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual(discovered, expectedFixtureFiles);

  const fixtures = discovered.map((name) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
    assert.equal(typeof fixture.id, 'string', `${name} fixture id`);
    assert.notEqual(fixture.id.trim(), '', `${name} fixture id non-empty`);
    assert.equal(typeof fixture.scenario, 'string', `${name} fixture scenario`);
    assert.equal(typeof fixture.expected.accepted, 'boolean', `${name} expected.accepted`);
    if (Object.prototype.hasOwnProperty.call(fixture.expected, 'mutationProhibited')) {
      assert.equal(typeof fixture.expected.mutationProhibited, 'boolean', `${name} mutationProhibited`);
      assert.equal(fixture.expected.mutationProhibited, true, `${name} mutationProhibited must be true for a rejected fixture`);
    }
    return fixture;
  });

  const ids = fixtures.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length, 'fixture IDs must be unique');

  const executed = new Set();
  for (const fixture of fixtures) {
    assert.equal(executed.has(fixture.id), false, `fixture executed twice: ${fixture.id}`);
    const actual = evaluateFixture(fixture);
    executed.add(fixture.id);
    assert.equal(actual.accepted, fixture.expected.accepted, fixture.id);
    for (const key of ['status', 'turn', 'classification', 'selection', 'completion', 'capacity', 'adoptedHead', 'selectedChild', 'freshG4Required', 'mutationProhibited']) {
      if (Object.prototype.hasOwnProperty.call(fixture.expected, key)) {
        assert.equal(actual[key], fixture.expected[key], `${fixture.id} ${key}`);
      }
    }
  }
  assert.equal(executed.size, fixtures.length, 'every fixture must execute');
  assert.deepEqual([...executed].sort(), ids.sort());
});

test('processed prompts retain durable audit and secret-safe context', () => {
  const processed = readJson('_main/fixtures/valid-processed-prompt.json');
  const invalid = readJson('_main/fixtures/invalid-secret-prompt.json');
  assert.equal(processed.state.prompt.payload, processedPromptMarker);
  assert.equal(processed.state.executorEvidenceRetained, true);
  assert.equal(looksSecretBearing(invalid.state.promptContent), true);
  assert.equal(looksSecretBearing(`name=${processed.state.secretContext.namesOnly[0]}; present=${processed.state.secretContext.presence}; value=${processed.state.secretContext.value}`), false);
  assert.match(readModule('_main/protocol.md'), /Redaction is visible cleanup, not guaranteed erasure/);
  assert.match(readModule('_main/state-machine.md'), /no live next-worker prompt remains/);
});
