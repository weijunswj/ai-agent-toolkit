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

const expectedFixtureFiles = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.json')).sort();
const requiredFixtureFiles = [
  'invalid-missing-github-issue-governance.json', 'invalid-missing-repo-auto-code.json', 'invalid-generic-consent-only.json',
  'invalid-governance-skill-missing.json', 'invalid-governance-skill-unhealthy.json', 'invalid-duplicate-canonical-parents.json',
  'invalid-governance-parent-baseline.json', 'invalid-governance-pending-reconciliation.json', 'invalid-governance-repository-mismatch.json',
  'invalid-ordinary-executor-self-setup.json', 'valid-governance-readiness.json', 'invalid-final-audit-selected-early.json',
  'invalid-final-audit-reordered.json', 'invalid-final-audit-bypassed-blocked.json', 'invalid-final-audit-not-last.json',
  'invalid-unauthorised-final-audit-change.json', 'valid-final-audit-after-terminal-work.json', 'valid-owner-authorised-final-audit-change.json',
  'invalid-substantive-execution-during-reconciliation.json', 'invalid-lying-surfaces-agree.json', 'invalid-lying-read-back-exact.json',
  'invalid-out-of-order-handoff-markers.json', 'invalid-nested-handoff-markers.json', 'invalid-crossed-handoff-markers.json',
  'invalid-missing-handoff-marker.json', 'invalid-live-prompt-after-completion.json', 'invalid-incomplete-review-sweep.json',
  'invalid-missing-exact-head-evidence.json', 'invalid-pending-user-action.json', 'invalid-pending-child-uat-material-obligation.json',
  'invalid-surface-disagreement-at-completion.json', 'invalid-cross-repository-scheduler-receipt.json', 'invalid-active-or-duplicate-scheduler.json',
  'valid-completion-finality.json', 'valid-exact-dual-scheduler-removal.json', 'valid-four-surface-reconciliation.json',
  'invalid-valid-mutation-unrelated-drift.json'
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

const envelopeMarkers = Object.freeze({
  oteStart: '[ ORCHESTRATOR TO EXECUTOR: START ]',
  oteEnd: '[ ORCHESTRATOR TO EXECUTOR: END ]',
  etoStart: '[ EXECUTOR TO ORCHESTRATOR: START ]',
  etoEnd: '[ EXECUTOR TO ORCHESTRATOR: END ]'
});

function parseEnvelopeEvidence(text) {
  if (typeof text !== 'string') return { valid: false, reason: 'missing_text' };
  const events = [];
  for (const [kind, marker] of Object.entries(envelopeMarkers)) {
    let offset = 0;
    while (true) {
      const index = text.indexOf(marker, offset);
      if (index === -1) break;
      events.push({ kind, marker, index });
      offset = index + marker.length;
    }
  }
  events.sort((left, right) => left.index - right.index);
  const counts = Object.fromEntries(Object.keys(envelopeMarkers).map((key) => [key, events.filter((event) => event.kind === key).length]));
  if (Object.values(counts).some((value) => value !== 1)) return { valid: false, reason: 'count', counts, events };
  const expectedOrder = ['oteStart', 'oteEnd', 'etoStart', 'etoEnd'];
  if (events.map((event) => event.kind).join('|') !== expectedOrder.join('|')) return { valid: false, reason: 'order', counts, events };
  const stack = [];
  const pairs = { oteStart: 'oteEnd', etoStart: 'etoEnd' };
  for (const event of events) {
    if (pairs[event.kind]) {
      if (stack.length > 0) return { valid: false, reason: 'nested', counts, events };
      stack.push(event.kind);
    } else {
      const opening = stack.pop();
      if (!opening || pairs[opening] !== event.kind) return { valid: false, reason: 'crossed', counts, events };
    }
  }
  if (stack.length !== 0) return { valid: false, reason: 'unclosed', counts, events };
  const finalEnd = events[events.length - 1];
  const trailing = text.slice(finalEnd.index + finalEnd.marker.length);
  const trailingLive = /(?:LIVE\s+NEXT[- ]WORKER\s+PROMPT|\[\s*(?:ORCHESTRATOR|EXECUTOR)\s+TO\s+)/i.test(trailing);
  return { valid: !trailingLive, reason: trailingLive ? 'trailing_live_payload' : null, counts, events };
}

function assertExactEnvelopeCounts(text, label) {
  const parsed = parseEnvelopeEvidence(text);
  assert.equal(parsed.valid, true, `${label}: globally valid marker grammar (${parsed.reason || 'ok'})`);
  assert.deepEqual(parsed.counts, { oteStart: 1, oteEnd: 1, etoStart: 1, etoEnd: 1 }, `${label}: derived marker counts`);
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
  assert.equal(parseEnvelopeEvidence(protocol).valid, true);
  assertExactEnvelopeCounts(protocol, 'protocol');
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
  assert.match(template, /github_issue_governance: enabled/);
  assert.match(template, /repo_auto_code: enabled/);
  assert.match(template, /AUTO_CODE_GOVERNANCE_UNREADY/);
  assert.match(template, /final whole-programme audit/);
  assert.match(template, /substantive execution/);
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
  assert.match(protocol, /createIfAbsent\(input(?:: ClaimInput)?\)/);
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
  for (const typeName of ['ClaimInput', 'CapabilityClaimResult', 'StoredClaimRecord', 'ClaimReadBack']) {
    assert.match(protocol, new RegExp(`type ${typeName}`), `closed claim type ${typeName}`);
  }
  const claimInputStart = protocol.indexOf('type ClaimInput');
  const claimInputEnd = protocol.indexOf('type StoredClaimRecord');
  const claimInput = protocol.slice(claimInputStart, claimInputEnd);
  for (const forbidden of ['leaseId', 'leaseExpiresAt', 'renewal', 'replacement', 'authority']) {
    assert.doesNotMatch(claimInput, new RegExp(forbidden), `ClaimInput excludes ${forbidden}`);
  }
  assert.match(protocol, /caller-supplied lease or authority fields/);
  assert.match(protocol, /cannot mint a lease, replace a lease, renew a lease, validate ownership, or supersede a claim/);
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

const parentBaselineSections = [
  'Queue authority',
  'Current execution',
  'Active queue',
  'Completed or disposed',
  'Completion gate',
  'Governance ownership',
  'Mandatory parent reconciliation'
];

const lifecycleSections = ['Current execution', 'Active queue', 'Completed or disposed'];
const claimAuthorityFields = [
  'leaseId',
  'leaseExpiresAt',
  'renewal',
  'replacement',
  'retirement',
  'supersession',
  'authority'
];

const materialProjectionFields = [
  'status', 'lifecycleSection', 'pr', 'branch', 'base', 'head', 'gate', 'designLock',
  'verdict', 'checks', 'reviewDisposition', 'blocker', 'requiredUserAction', 'currentTurn',
  'nextAction', 'acceptance', 'merge', 'closure', 'completion'
];

const expectedRepositoryIdentity = 'weijunswj/ai-agent-toolkit';
const expectedSchedulerTasks = Object.freeze({
  controller: 'repo-329-controller',
  executor: 'repo-329-executor'
});

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectionFromRaw(surface, defaults = {}) {
  if (!surface || typeof surface !== 'object') return null;
  const merged = { ...defaults, ...surface };
  return Object.fromEntries(materialProjectionFields.map((field) => [field, merged[field]]));
}

function deriveSurfaceAgreement(surfaces, defaults = {}) {
  if (!surfaces || typeof surfaces !== 'object') return false;
  const entries = ['child', 'pr', 'parentEntry', 'chronology'].map((name) => projectionFromRaw(surfaces[name], defaults));
  if (entries.some((projection) => projection === null)) return false;
  return entries.every((projection) => jsonEqual(projection, entries[0]));
}

function validatePreservationEvidence(preservation) {
  if (!preservation || typeof preservation !== 'object') return false;
  const before = preservation.before;
  const after = preservation.after;
  const keys = [
    'unrelatedParentEntries', 'queueOrder', 'extensionSections', 'completedHistory',
    'ownerAuthoredContent', 'unrelatedChildren', 'unrelatedPr', 'unrelatedChronology'
  ];
  return before && after && keys.every((key) => Object.prototype.hasOwnProperty.call(before, key)
    && Object.prototype.hasOwnProperty.call(after, key) && jsonEqual(before[key], after[key]));
}

function rejected(status, details = {}) {
  return { ...details, accepted: false, status, mutationProhibited: true };
}

function validateParentLifecycle(parent) {
  if (!parent || !Array.isArray(parent.sectionOrder)) return false;
  const extensionSections = parent.extensionSections || [];
  const baselineOrder = parent.sectionOrder.filter((section) => !extensionSections.includes(section));
  if (JSON.stringify(baselineOrder) !== JSON.stringify(parentBaselineSections)) return false;
  const activeIndex = parent.sectionOrder.indexOf('Active queue');
  const completedIndex = parent.sectionOrder.indexOf('Completed or disposed');
  if (activeIndex === -1 || completedIndex === -1 || completedIndex <= activeIndex) return false;
  if (extensionSections.some((section) => {
    const index = parent.sectionOrder.indexOf(section);
    return index <= activeIndex || index >= completedIndex;
  })) return false;

  const linesBySection = parent.linesBySection || {};
  for (const section of ['Current execution', 'Active queue']) {
    for (const line of linesBySection[section] || []) {
      if (!/^\-\s+(?!\[[ xX]\])\S/.test(line)) return false;
    }
  }
  for (const line of linesBySection['Completed or disposed'] || []) {
    if (!/^\-\s+\[x\]\s+\S/.test(line)) return false;
  }
  for (const [section, lines] of Object.entries(linesBySection)) {
    if (!lifecycleSections.includes(section) && lines.some((line) => /^\-\s+\[[ xX]\]/.test(line))) return false;
  }

  const entries = parent.lifecycleEntries || {};
  const materialChildren = parent.materialChildren || [];
  for (const child of materialChildren) {
    const occurrences = lifecycleSections.flatMap((section) => (entries[section] || []).filter((entry) => entry === child));
    if (occurrences.length !== 1) return false;
    if (parent.expectedLifecycle && parent.expectedLifecycle[child]) {
      const actualSection = lifecycleSections.find((section) => (entries[section] || []).includes(child));
      if (actualSection !== parent.expectedLifecycle[child]) return false;
    }
  }
  if ((parent.parentEntryCount !== undefined && parent.parentEntryCount !== 1) || parent.unauthorisedReorder === true) return false;
  if (parent.reorder && parent.reorder.changed === true && parent.reorder.authorized !== true) return false;
  if (Array.isArray(parent.subqueues) && parent.subqueues.length > 0) return false;
  return true;
}

function validateFourSurfaceReconciliation(reconciliation) {
  if (!reconciliation || typeof reconciliation !== 'object') return false;
  const defaults = reconciliation.projectionDefaults || {};
  if (!deriveSurfaceAgreement(reconciliation.surfaces, defaults)) return false;
  const before = projectionFromRaw(reconciliation.transitionBefore, defaults);
  const after = projectionFromRaw(reconciliation.transitionAfter, defaults);
  if (!before || !after || jsonEqual(before, after)) return false;
  const binding = reconciliation.binding;
  if (!binding || binding.boundRevision !== binding.revisionBeforeWrite || binding.revisionAfterWrite !== binding.boundRevision) return false;
  if (binding.readBackRevision !== binding.revisionAfterWrite || binding.parentEntryCount !== 1) return false;
  if (binding.rowPositionBefore !== binding.rowPositionAfter || binding.chronologyCommentsAdded !== 1) return false;
  if (!binding.afterBodyDigest || binding.readBackBodyDigest !== binding.afterBodyDigest) return false;
  if (binding.concurrentBeforeWrite === true || binding.concurrentAfterWrite === true || binding.partialWrite === true) return false;
  if (!validatePreservationEvidence(reconciliation.preservation)) return false;
  return true;
}

function validateClaimInput(state) {
  const input = state.claimInput;
  if (!input || typeof input !== 'object') return false;
  if (Object.keys(input).some((key) => claimAuthorityFields.includes(key))) return false;
  if (state.capability.rejectsCallerAuthorityFields !== true) return false;
  if (state.capability.callerCanMintLease !== false || state.capability.callerCanReplaceLease !== false || state.capability.callerCanRenewLease !== false || state.capability.callerCanValidateLease !== false || state.capability.callerCanSupersedeLease !== false) return false;
  return true;
}

function schedulerIdentities(state) {
  if (Array.isArray(state.schedules?.tasks)) return state.schedules.tasks;
  return ['controller', 'executor'].map((name) => state.schedules?.[name]).filter(Boolean);
}

function validateExactSchedulerRemoval(state) {
  const tasks = schedulerIdentities(state);
  if (tasks.length !== 2) return false;
  const authority = state.schedules?.authority;
  if (!authority || authority.repository !== expectedRepositoryIdentity
    || authority.generation !== 'generation-1' || authority.revision !== 'revision-1') return false;
  const identities = tasks.map((task) => task.identity);
  if (new Set(identities).size !== identities.length
    || identities[0] !== expectedSchedulerTasks.controller
    || identities[1] !== expectedSchedulerTasks.executor) return false;
  return tasks.every((task) => {
    if (task.repository !== expectedRepositoryIdentity || task.status !== 'REMOVED') return false;
    if (task.generation !== authority.generation || task.revision !== authority.revision) return false;
    const receipt = task.removalReceipt;
    return receipt && receipt.trusted === true
      && receipt.repository === expectedRepositoryIdentity
      && receipt.taskIdentity === task.identity
      && receipt.generation === authority.generation
      && receipt.revision === authority.revision;
  });
}

function validateCompletionEligibility(state) {
  const reviews = state.reviewSweep;
  const checks = state.checks;
  const head = state.exactHead;
  const obligations = state.obligations;
  const merge = state.mergePrerequisites;
  const prompt = state.prompt;
  const independentProtocol = state.protocolEvidence;
  return reviews?.complete === true
    && reviews.validOpenReviews === 0
    && Array.isArray(checks) && checks.length > 0
    && checks.every((check) => check.required === true && check.completed === true && check.conclusion === 'PASS')
    && independentProtocol?.independent === true && independentProtocol.ledgerOnly === false
    && head?.reviewedHead && head.reviewedHead === head.currentHead && head.readBack === true
    && state.controllerGate === 'CONTROLLER_ACCEPTED'
    && prompt?.live === false && prompt.processed === true && state.pendingResult === false
    && obligations && obligations.child === false && obligations.user === false && obligations.uat === false && obligations.material === false
    && validateFourSurfaceReconciliation(state.reconciliation)
    && merge?.complete === true && merge.baseVerified === true && merge.headVerified === true
    && merge.noConflicts === true && validateExactSchedulerRemoval(state);
}

function validateGovernanceReadiness(state) {
  const repository = state.repository;
  const capabilities = state.capabilities;
  const skill = state.governanceSkill;
  const parent = state.canonicalParent;
  const actor = state.actor;
  if (!repository || `${repository.owner}/${repository.name}` !== expectedRepositoryIdentity
    || repository.immutableId !== 'repo-299'
    || repository.origin !== 'https://github.com/weijunswj/ai-agent-toolkit.git'
    || repository.defaultBranch !== 'main') return false;
  if (!capabilities || capabilities.github_issue_governance !== 'enabled' || capabilities.repo_auto_code !== 'enabled') return false;
  if (!skill || skill.id !== '#299' || skill.installed !== true || skill.healthy !== true || skill.inspectable !== true) return false;
  if (!parent || parent.count !== 1 || !validateParentLifecycle(parent.structure)) return false;
  if (state.reconciliationBlocker === 'PARENT_RECONCILIATION_INCOMPLETE' || state.concurrentParentMovement === true) return false;
  if (!deriveSurfaceAgreement(state.projections)) return false;
  if (!actor || actor.authorized !== true || !['web-controller', 'governance-setup-executor'].includes(actor.role)) return false;
  return true;
}

function validateFinalAuditInvariant(state) {
  const parent = state.parent;
  if (!parent || !Array.isArray(parent.activeQueue) || parent.activeQueue.length === 0) return false;
  const audits = parent.activeQueue.filter((entry) => entry.finalAudit === true);
  if (audits.length !== 1 || parent.activeQueue[parent.activeQueue.length - 1] !== audits[0]) return false;
  const audit = audits[0];
  const preceding = parent.activeQueue.slice(0, -1);
  if (preceding.some((entry) => entry.terminal !== true)) return false;
  if (state.selectedChild !== audit.child) return false;
  if (state.moved === true || state.reordered === true || state.bypassedBlocked === true) return false;
  if (state.declarationChange && state.declarationChange.requested === true
    && (state.declarationChange.authorized !== true || !['owner', 'web-controller'].includes(state.declarationChange.actor))) return false;
  return true;
}

function validateSubstantiveStop(state) {
  if (state.blocker !== 'PARENT_RECONCILIATION_INCOMPLETE') return false;
  if (!Array.isArray(state.attemptedActions) || !state.attemptedActions.includes('substantive execution')) return false;
  if (!state.promptIssued || !state.claimIssued) return false;
  const mutation = state.mutation;
  return mutation && mutation.stopBeforeMutation === true
    && mutation.localEvidencePreserved === true
    && mutation.newCommit === false
    && mutation.push === false
    && mutation.externalMutation === false
    && mutation.gate !== 'GATE_RUNNING';
}

function evaluateFixture(fixture) {
  const state = fixture.state;
  switch (fixture.scenario) {
    case 'baseline_section_order':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'bullet_checkbox_style':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'child_duplicate_lifecycle':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'child_missing_lifecycle':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'current_item_active':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'terminal_item_nonterminal':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'duplicate_parent_entry':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'missing_parent_entry':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'unauthorised_queue_reorder':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'competing_category_subqueues':
      assert.equal(validateParentLifecycle(state.parent), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'active_to_current': {
      const transition = state.transition;
      assert.equal(transition.atomic, true);
      assert.equal(transition.before.active.includes(transition.child), true);
      assert.equal(transition.after.active.includes(transition.child), false);
      assert.equal(transition.after.current.includes(transition.child), true);
      assert.equal(transition.parentEntryCount, 1);
      assert.equal(transition.chronologyCommentsAdded, 1);
      return { accepted: true, transition: 'ACTIVE_TO_CURRENT', selectedChild: transition.child };
    }

    case 'current_to_completed': {
      const transition = state.transition;
      assert.equal(transition.atomic, true);
      assert.equal(transition.before.current.includes(transition.child), true);
      assert.equal(transition.after.current.includes(transition.child), false);
      assert.equal(transition.after.active.includes(transition.child), false);
      assert.equal(transition.after.completed.includes(transition.child), true);
      assert.equal(transition.after.completedLineStyle, '- [x]');
      assert.equal(transition.parentEntryCount, 1);
      assert.equal(transition.chronologyCommentsAdded, 1);
      return { accepted: true, transition: 'CURRENT_TO_COMPLETED', selectedChild: transition.child };
    }

    case 'first_eligible_pickup': {
      const eligible = state.parent.activeQueue.find((entry) => entry.eligible === true && entry.blocked !== true);
      assert.ok(eligible);
      assert.equal(eligible.child, state.parent.activeQueue[0].child);
      return { accepted: true, selectedChild: eligible.child, selection: 'top_to_bottom_first_eligible' };
    }

    case 'blocked_first_skip': {
      assert.equal(state.parent.activeQueue[0].blocked, true);
      assert.deepEqual(state.parent.orderBefore, state.parent.orderAfter);
      assert.equal(state.parent.skipRecorded, true);
      assert.equal(state.parent.blockedItemMoved, false);
      assert.equal(state.parent.selectedChild, state.parent.activeQueue[1].child);
      return { accepted: true, selectedChild: state.parent.selectedChild, selection: 'skip_blocked_in_place' };
    }

    case 'four_surface_reconciliation':
      assert.equal(validateFourSurfaceReconciliation(state.reconciliation), true);
      return { accepted: true, reconciliation: 'FOUR_SURFACE_READ_BACK', preservedUnrelated: true };

    case 'lying_surfaces_agree':
    case 'lying_read_back_exact':
    case 'valid_mutation_unrelated_drift':
      assert.equal(validateFourSurfaceReconciliation(state.reconciliation), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'exact_dual_scheduler_removal':
      assert.equal(validateExactSchedulerRemoval(state), true);
      return { accepted: true, scheduler: 'REMOVED', completion: 'allowed_after_exact_dual_removal' };

    case 'first_run':
      assert.equal(state.repository.exact, true);
      assert.equal(state.phase, 'SETUP');
      assert.equal(state.capabilities.github_issue_governance, 'enabled');
      assert.equal(state.capabilities.repo_auto_code, 'enabled');
      assert.equal(state.setupActor.role, 'web-controller');
      assert.equal(state.skill.available, true);
      assert.equal(state.skill.inspectable, true);
      assert.equal(state.managedBlock.status, 'ABSENT');
      assert.equal(state.schedules.controller, 'absent');
      assert.equal(state.schedules.executor, 'absent');
      assert.equal(state.packet.status, 'NONE');
      assert.equal(fixture.expected.mutation, 'safe_preparation_only');
      return { accepted: true, turn: 'CONTROLLER_TURN', mutation: 'safe_preparation_only' };

    case 'existing_pr_adoption':
      assert.equal(validateGovernanceReadiness(state), true);
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
      assert.deepEqual(state.subqueues, []);
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
      assert.equal(state.validOpenReviews, 0);
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
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

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
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');
    }

    case 'parent_child_pr_status_mismatch':
    case 'head_mismatch':
    case 'wrong_current_turn':
    case 'next_action_mismatch':
    case 'missing_parent_chronology':
    case 'concurrent_edit_before_write':
    case 'concurrent_edit_after_write':
    case 'unrelated_parent_content_changed':
      assert.equal(validateFourSurfaceReconciliation(state.reconciliation), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'progression_during_parent_reconciliation':
      assert.equal(state.blocker, 'PARENT_RECONCILIATION_INCOMPLETE');
      for (const action of state.attemptedActions) {
        assert.equal(state.prohibitedActions.includes(action), true, `prohibited action: ${action}`);
      }
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'substantive_execution_during_reconciliation':
      assert.equal(validateSubstantiveStop(state), true);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'governance_readiness':
      assert.equal(validateGovernanceReadiness(state), fixture.expected.accepted);
      return fixture.expected.accepted
        ? { accepted: true, readiness: 'INDEPENDENT_DUAL_CAPABILITY' }
        : rejected('AUTO_CODE_GOVERNANCE_UNREADY');

    case 'final_audit_eligible':
    case 'final_audit_selected_early':
    case 'final_audit_reordered':
    case 'final_audit_bypassed_blocked':
    case 'final_audit_not_last':
    case 'unauthorised_final_audit_change':
    case 'owner_authorised_final_audit_change':
      if (fixture.scenario === 'final_audit_eligible' || fixture.scenario === 'owner_authorised_final_audit_change') {
        assert.equal(validateFinalAuditInvariant(state), true);
        return { accepted: true, selection: 'FINAL_AUDIT_AFTER_TERMINAL_WORK' };
      }
      assert.equal(validateFinalAuditInvariant(state), false);
      return rejected('PARENT_RECONCILIATION_INCOMPLETE');

    case 'caller_supplied_lease_fields':
      assert.equal(state.capability.rejectsCallerAuthorityFields, true);
      assert.equal(state.capability.callerCanMintLease, false);
      assert.equal(state.capability.callerCanReplaceLease, false);
      assert.equal(state.capability.callerCanRenewLease, false);
      assert.equal(state.capability.callerCanValidateLease, false);
      assert.equal(state.capability.callerCanSupersedeLease, false);
      assert.equal(validateClaimInput(state), false);
      return rejected('CLAIM_INPUT_AUTHORITY_FIELDS_REJECTED');

    case 'duplicate_ote_eto_markers': {
      const parsed = parseEnvelopeEvidence(state.promptText);
      assert.equal(parsed.valid, false);
      assert.equal(parsed.reason, 'count');
      return rejected('DUPLICATE_HANDOFF_MARKER');
    }

    case 'out_of_order_handoff_markers':
    case 'nested_handoff_markers':
    case 'crossed_handoff_markers':
    case 'missing_handoff_marker': {
      const parsed = parseEnvelopeEvidence(state.promptText);
      assert.equal(parsed.valid, false);
      return rejected('MALFORMED_HANDOFF_MARKER');
    }

    case 'live_prompt_after_completion': {
      const parsed = parseEnvelopeEvidence(state.promptText);
      assert.equal(parsed.valid, false);
      assert.equal(parsed.reason, 'trailing_live_payload');
      return rejected('LIVE_PROMPT_REMAINS');
    }

    case 'missing_valid_open_reviews':
      assert.equal(Object.prototype.hasOwnProperty.call(state, 'validOpenReviews'), false);
      assert.equal(validateCompletionEligibility(state), false);
      return rejected('COMPLETION_GATE_INCOMPLETE');

    case 'disabled_scheduler':
    case 'paused_scheduler':
    case 'duplicate_scheduler':
    case 'ambiguous_scheduler':
    case 'unverifiable_missing_scheduler':
      assert.equal(validateExactSchedulerRemoval(state), false);
      return rejected('INCOMPLETE_SCHEDULER_TEARDOWN');

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
      assert.equal(state.teardownState, 'PARTIALLY_REMOVED');
      assert.equal(state.otherRepositoryAffected, false);
      assert.equal(validateExactSchedulerRemoval(state), false);
      return rejected('INCOMPLETE_SCHEDULER_TEARDOWN');

    case 'completion_finality':
      assert.equal(validateCompletionEligibility(state), fixture.expected.accepted);
      return fixture.expected.accepted
        ? { accepted: true, completion: 'DERIVED_FINALITY' }
        : rejected('COMPLETION_GATE_INCOMPLETE');

    case 'cross_repository_scheduler_receipt':
    case 'active_or_duplicate_scheduler':
      assert.equal(validateExactSchedulerRemoval(state), false);
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
  assert.equal(fs.existsSync(path.join(repoRoot, 'claim-backend')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'controller-runtime')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'executor-runtime')), false);
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
    assertExactEnvelopeCounts(prompt, 'scheduled prompt');
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
    'F-031', 'F-032', 'F-033', 'F-034', 'F-035', 'F-036', 'F-037', 'F-038', 'F-039', 'F-040', 'F-041',
    'F-042', 'F-043', 'F-044', 'F-045', 'F-046', 'F-047', 'F-048', 'F-049', 'F-050', 'F-051', 'F-052', 'F-053', 'F-054'
  ]) {
    assert.match(matrix, new RegExp(`\\| ${id} \\|`), `failure row ${id}`);
  }
  assert.match(matrix, /\| F-034 \|[\s\S]*?\| `HELD` \|/);
  assert.match(matrix, /\| F-041 \|[\s\S]*?\| `HELD` \|/);
  assert.match(matrix, /PARENT_RECONCILIATION_INCOMPLETE/);
  assert.match(matrix, /sole verified terminal state `REMOVED`/);
  assert.match(matrix, /AUTO_CODE_GOVERNANCE_UNREADY/);
  assert.match(matrix, /final whole-programme audit/i);
  assert.match(matrix, /substantive execution/);
  assert.match(matrix, /fixture or result supplies/i);
});

test('controller prompt location and lifecycle state boundaries are explicit', () => {
  const architecture = readModule('_main/architecture.md');
  const lifecycle = readModule('_main/state-machine.md');
  assert.match(architecture, /Manual controller prompts[\s\S]*active web conversation/);
  assert.match(architecture, /not copied into GitHub bodies or comments or into scheduled-task payloads/);
  assert.match(architecture, /Queue authority[\s\S]*Current execution[\s\S]*Active queue[\s\S]*Completed or disposed[\s\S]*Completion gate[\s\S]*Governance ownership[\s\S]*Mandatory parent reconciliation/);
  assert.match(architecture, /Visible numeric prefixes are optional; list position is authoritative/);
  assert.match(architecture, /blocked first item stays in place/);
  assert.match(architecture, /Only the owner or an explicitly authorised governance actor may reorder/);
  assert.match(architecture, /final whole-programme audit/);
  assert.match(architecture, /github_issue_governance: enabled/);
  assert.match(architecture, /repo_auto_code: enabled/);
  assert.match(architecture, /AUTO_CODE_GOVERNANCE_UNREADY/);
  assert.match(architecture, /stops substantive execution/);
  assert.match(architecture, /Active queue -> Current execution -> Completed or disposed/);
  for (const label of ['SETUP', 'PREPARED', 'SCHEDULED', 'ENROLLED', 'CLAIMED', 'RUNNING', 'ACCEPTED', 'COMPLETE']) {
    assert.match(lifecycle, new RegExp('`' + label + '`'));
  }
  assert.match(lifecycle, /prepared prompts alone never set this state/);
  assert.match(lifecycle, /A trusted atomic read-back verifies one capability-issued lease/);
  assert.match(lifecycle, /merge and teardown remain separate/);
  assert.match(lifecycle, /PARENT_RECONCILIATION_INCOMPLETE/);
  assert.match(lifecycle, /only terminal scheduler evidence state is `REMOVED`/);
});

test('material transitions use four-surface compare-and-preserve reconciliation and a hard progression blocker', () => {
  const protocol = readModule('_main/protocol.md');
  for (const field of [
    'lifecycle section', 'status', 'gate', 'Design Lock', 'PR, branch, base, or head', 'verdict',
    'checks', 'review disposition', 'blocker', 'required user action', 'current turn',
    'immediate next action', 'acceptance', 'merge', 'closure', 'completion'
  ]) {
    assert.match(protocol, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(protocol, /child body[\s\S]*PR body when a PR exists[\s\S]*exactly one existing parent lifecycle entry[\s\S]*one new parent chronology comment/);
  assert.match(protocol, /compare-and-preserve/);
  assert.match(protocol, /patch only that row/);
  assert.match(protocol, /preserve every unrelated entry/);
  assert.match(protocol, /PARENT_RECONCILIATION_INCOMPLETE/);
  assert.match(protocol, /substantive execution/);
  assert.match(protocol, /raw surface projections/);
  assert.match(protocol, /exact web-controller task identity/);
  for (const action of ['another worker prompt', 'auto-code pickup or claim', 'G4 authorisation', 'controller acceptance', 'ready-state mutation', 'merge or auto-merge', 'child closure', 'next-task selection', 'verification claims', 'programme completion']) {
    assert.match(protocol, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const gate of ['GATE_AUTHORISED', 'GATE_RUNNING', 'GATE_RESULT_RECEIVED', 'CONTROLLER_ACCEPTED']) {
    assert.match(protocol, new RegExp(gate));
  }
});

test('completion finality requires independent review/check/merge/teardown evidence', () => {
  const protocol = readModule('_main/protocol.md');
  const controller = readModule('_main/templates/web-controller-scheduled-task.prompt.md');
  const executor = readModule('_main/templates/executor-scheduled-task.prompt.md');
  for (const text of [protocol, controller, executor]) {
    assert.match(text, /validOpenReviews/);
    assert.match(text, /no live final prompt/i);
    assert.match(text, /ledger/i);
    assert.match(text, /CONTROLLER_ACCEPTED/);
    assert.match(text, /REMOVED/);
  }
  assert.match(protocol, /required checks are complete and passing/);
  assert.match(protocol, /merge prerequisites are complete/);
  assert.match(protocol, /teardown prerequisites are complete/);
  assert.match(protocol, /pending child, user-action, UAT, or other material obligation/);
  assert.match(protocol, /parent, child, and PR material projections agree/);
});

test('governance readiness, final-audit finality, substantive stop, and marker derivation are explicit', () => {
  const architecture = readModule('_main/architecture.md');
  const stateMachine = readModule('_main/state-machine.md');
  const controller = readModule('_main/templates/web-controller-scheduled-task.prompt.md');
  const executor = readModule('_main/templates/executor-scheduled-task.prompt.md');
  for (const text of [architecture, stateMachine, controller, executor]) {
    assert.match(text, /AUTO_CODE_GOVERNANCE_UNREADY/);
    assert.match(text, /github_issue_governance: enabled/);
    assert.match(text, /repo_auto_code: enabled/);
    assert.match(text, /final whole-programme audit/);
    assert.match(text, /substantive execution/);
  }
  const markerFixture = readJson('_main/fixtures/invalid-duplicate-ote-eto-markers.json');
  const markerEvidence = parseEnvelopeEvidence(markerFixture.state.promptText);
  assert.equal(markerEvidence.valid, false);
  assert.equal(markerEvidence.reason, 'count');
  const liar = readJson('_main/fixtures/invalid-lying-surfaces-agree.json');
  assert.equal(liar.state.reconciliation.surfacesAgree, true);
  assert.equal(validateFourSurfaceReconciliation(liar.state.reconciliation), false);
});

test('every authorised fixture is discovered, unique, executed, and behaviorally asserted', () => {
  const discovered = fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual(discovered, expectedFixtureFiles);
  for (const required of requiredFixtureFiles) assert.ok(discovered.includes(required), `required fixture discovered: ${required}`);

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
    for (const [key, expectedValue] of Object.entries(fixture.expected)) {
      assert.deepEqual(actual[key], expectedValue, `${fixture.id} ${key}`);
    }
    if (fixture.expected.accepted === false) {
      assert.equal(fixture.expected.mutationProhibited, true, `${fixture.id} rejected fixture must prohibit mutation`);
      assert.equal(actual.mutationProhibited, true, `${fixture.id} rejected result must prohibit mutation`);
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
