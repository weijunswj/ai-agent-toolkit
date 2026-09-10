'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const programme = require('../scripts/toolkit-github-program-state-v5.cjs');
const governance = require('../scripts/toolkit-github-governance-review-reconciler.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const contractRoot = path.join(projectRoot, 'repo', 'contracts');
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha = (letter) => String(letter).repeat(40);
const digest = (letter) => String(letter).repeat(64);

function genericState(options = {}) {
  const epochs = options.epochs || [{
    id: 'P1', name: 'Build', purpose: 'Build the package.',
    terminal_disposition: null, evidence_ref: null,
  }];
  return {
    schema: 'example.program.state.v1',
    repository: 'example-co/managed-product',
    parent: { issue: 71, title: 'Managed Product Programme', goal: 'Deliver a useful managed product.' },
    children: [
      {
        issue: 72, order: 1, title: 'Finished foundation', lifecycle: 'COMPLETED',
        summary: 'The foundation is complete.', objective: 'Complete the foundation.',
        scope: ['Foundation work'], boundaries: ['Keep the foundation closed.'],
        out_of_scope: ['Later packages'], done_when: ['Accepted evidence exists.'],
        eli5: 'The foundation is done.', finality: { state: 'MERGED' },
        epochs: [{ id: 'F1', name: 'Foundation', purpose: 'Complete the foundation.', terminal_disposition: 'ACCEPTED', evidence_ref: 'foundation-accepted' }],
        pr_registry: [],
      },
      {
        issue: 73, order: 2, title: 'Current delivery package', lifecycle: 'CURRENT',
        summary: 'The current package is being delivered.', objective: 'Deliver the current package.',
        scope: ['Current package scope'], boundaries: ['Current package boundary'],
        out_of_scope: ['Future package'], done_when: ['The package is accepted.'],
        eli5: 'This is the package being worked on.', finality: { state: 'UNMERGED' },
        epochs, holds: options.holds || [], pr_registry: options.prRegistry || [],
        ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      },
      {
        issue: 74, order: 3, title: 'Queued follow-up', lifecycle: 'QUEUED',
        summary: 'The follow-up waits in order.', objective: 'Deliver the follow-up.',
        scope: ['Follow-up scope'], boundaries: ['Follow-up boundary'],
        out_of_scope: ['Unplanned work'], done_when: ['Follow-up accepted.'],
        eli5: 'This work waits its turn.', finality: { state: 'HELD' },
        epochs: [{ id: 'Q1', name: 'Follow-up', purpose: 'Deliver the follow-up.', terminal_disposition: null, evidence_ref: null }],
        pr_registry: [],
      },
    ],
    prs: options.prs || [],
    evidence_refs: [
      { id: 'foundation-accepted', kind: 'WEB', reference: 'example:evidence:foundation', summary: 'The foundation was accepted by the controller.' },
      ...(options.evidence_refs || []),
    ],
    active_lanes: options.active_lanes || [],
    historical_transitions: [],
    ...(options.stateExtras || {}),
  };
}

function descriptor(number, purpose, extra = {}) {
  return {
    changed_surfaces: ['Human-readable programme surfaces.'],
    child_issue: 359,
    design_constraints: ['Intermediate work does not complete the child.'],
    eli5: 'This record explains why the change exists.',
    evidence_refs: [],
    number,
    out_of_scope: ['Live provider mutation.'],
    purpose,
    scope: ['Deterministic presentation and history.'],
    summary: purpose,
    validation_requirements: ['Focused conformance tests.'],
    ...extra,
  };
}

function candidate(seed, headLetter = 'b', treeLetter = 'c') {
  return {
    repository: 'weijunswj/ai-agent-toolkit',
    branch: 'codex/history-' + String(seed),
    base_ref: 'main',
    base_sha: sha('a'),
    head: sha(headLetter),
    tree: sha(treeLetter),
    version: '2.10.9',
  };
}

function historyDecision(source, additions = {}, accepted = []) {
  const immutable = programme.humanHistoryImmutableDigest(source);
  return programme.createHumanSurfaceConformanceDecision({
    root: 'S2-PRE-E4-HUMAN-SURFACE-CONFORMANCE-CONVERGENCE-002',
    lock: 'DL-S2-PRE-E4-HUMAN-SURFACE-CONFORMANCE-CONVERGENCE-002',
    repository: source.repository,
    source: {
      schema: source.schema,
      canonical_digest: programme.digestValue(source),
      immutable_digest: immutable,
      state: source,
    },
    authority: {
      kind: 'USER_WEB_CONTROLLER', repository: source.repository, issue: 384,
      comment_id: 5611853673, body_digest: digest('a'),
    },
    history_additions: {
      prs: additions.prs || [],
      registry: additions.registry || [],
      evidence_refs: additions.evidence_refs || [],
      historical_transitions: additions.historical_transitions || [],
    },
    accepted_candidate_identities: accepted,
    invariants: {
      immutable_digest: immutable,
      allowed_paths: programme.HUMAN_V2_HISTORY_ALLOWED_PATHS,
      provider_evidence_observational_only: true,
      no_provider_target_rebase: true,
      no_state_movement: true,
    },
  });
}

function assertCode(result, expected) {
  assert.equal(result.ok, false, 'expected failure ' + expected + ', got success');
  assert.equal(result.code, expected, result.reason || result.code);
}

function carrierLine(body, marker) {
  return body.split('\n').find((line) => line.startsWith(marker));
}

function tamperCarrier(body, marker) {
  const line = carrierLine(body, marker);
  assert.ok(line);
  const encoded = line.slice(marker.length, -4);
  const replacement = (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);
  return body.replace(line, marker + replacement + ' -->');
}

test('F1 parent is the canonical owner and child/PR surfaces require external rebinding', () => {
  const state = programme.FINALISATION_STAGE_B_TARGET_STATE;
  const parent = programme.renderHumanV2Parent(state);
  assert.equal(parent.ok, true, parent.code + ' ' + parent.reason);
  assert.equal(parent.carrier.canonical.state.schema, state.schema);
  assert.equal(Object.prototype.hasOwnProperty.call(parent.carrier, 'presentation_model'), false);
  const parsed = programme.parseHumanV2Parent({ body: parent.body, complete: true }, {
    repository: state.repository, parent_issue: state.parent.issue, schema: state.schema,
  });
  assert.equal(parsed.ok, true, parsed.code + ' ' + parsed.reason);
  assert.deepEqual(parsed.state, state);
  assert.equal(parsed.canonical_digest, programme.digestValue(state));

  const child = programme.renderHumanV2Child(state, 359);
  assert.equal(child.ok, true, child.code + ' ' + child.reason);
  assert.equal(Object.prototype.hasOwnProperty.call(child.carrier.canonical, 'state'), false);
  const childParsed = programme.parseHumanV2Child({ body: child.body, complete: true });
  assert.equal(childParsed.ok, true, childParsed.code + ' ' + childParsed.reason);
  const wrongSourceState = clone(state);
  wrongSourceState.evidence_refs = [...wrongSourceState.evidence_refs, { id: 'wrong-source', kind: 'WEB', reference: 'example:evidence:wrong-source', summary: 'A different validated source state.' }];
  const wrongSource = programme.verifyHumanV2Child({ body: child.body, complete: true }, wrongSourceState, 359);
  assert.equal(wrongSource.ok, false);
  assert.ok(['HUMAN_IDENTITY_MISMATCH', 'CANONICAL_DIGEST_MISMATCH'].includes(wrongSource.code), wrongSource.code);
  const proseTampered = programme.parseHumanV2Parent({ body: parent.body.replace('Current programme', 'Current programme changed'), complete: true });
  assertCode(proseTampered, 'PUBLIC_PROSE_DIGEST_MISMATCH');
  const carrierTampered = programme.parseHumanV2Parent({
    body: tamperCarrier(parent.body, programme.HUMAN_V2_TOOLKIT_MARKERS.parent.carrier), complete: true,
  });
  assert.equal(carrierTampered.ok, false);
  assert.ok(['CARRIER_DECODE_INVALID', 'CARRIER_SCHEMA_INVALID', 'CANONICAL_DIGEST_MISMATCH'].includes(carrierTampered.code), carrierTampered.code);
});

test('F2 history target validation rejects a shape-valid but canonically invalid target', () => {
  const source = clone(programme.FINALISATION_STAGE_B_TARGET_STATE);
  const decision = historyDecision(source);
  const derived = programme.deriveHumanSurfaceHistoryTarget({ source, decision });
  assert.equal(derived.ok, true, derived.code + ' ' + derived.reason);
  const invalidTarget = clone(derived.target_state);
  invalidTarget.children[1].epochs[0].name = 'Changed outside history paths';
  assert.equal(programme.validateHumanCanonicalState(invalidTarget).ok, false);
  const rejected = programme.deriveHumanSurfaceHistoryTarget({
    source, decision, target_state: invalidTarget, target_canonical_digest: programme.digestValue(invalidTarget),
  });
  assertCode(rejected, 'HISTORY_TARGET_CANONICAL_INVALID');
});

test('F3 candidate identities are exact, two-sided, and bound to child and epoch', () => {
  const source = clone(programme.FINALISATION_STAGE_B_TARGET_STATE);
  const prCandidate = candidate(901);
  const prDescriptor = descriptor(901, 'Retain the authorised historical candidate chronology.', { candidate: prCandidate });
  const registryEntry = {
    accepted_evidence_ref: 'candidate-901', candidate: prCandidate, completes_child: false, draft: false,
    epoch_id: 'E3', github_state: 'OPEN', merged: false, pr: 901,
    retention_evidence_ref: null, retirement_evidence_ref: null, role: 'INTERMEDIATE', status: 'RETAINED',
  };
  const additions = {
    prs: [prDescriptor],
    registry: [{ child_issue: 359, entry: registryEntry }],
    evidence_refs: [{ id: 'candidate-901', kind: 'WEB', reference: 'example:evidence:901', summary: 'The candidate identity was accepted.' }],
  };
  const accepted = [{ pr_number: 901, candidate: prCandidate, child_issue: 359, epoch_id: 'E3' }];
  const valid = historyDecision(source, additions, accepted);
  assert.equal(programme.validateHumanSurfaceConformanceDecision(valid).ok, true);

  assert.throws(() => historyDecision(source, additions, []), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_SET_MISMATCH');
  assert.throws(() => historyDecision(source, additions, [...accepted, { pr_number: 902, candidate: candidate(902, 'd', 'e'), child_issue: 359, epoch_id: 'E3' }]), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_SET_MISMATCH');
  assert.throws(() => historyDecision(source, additions, [...accepted, { ...accepted[0] }]), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_INVALID');
  assert.throws(() => historyDecision(source, { ...additions, registry: [] }, accepted), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH');
  assert.throws(() => historyDecision(source, { ...additions, prs: [] }, accepted), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH');
  const oneSidedRegistry = clone(registryEntry);
  oneSidedRegistry.candidate = candidate(901, 'f', 'e');
  assert.throws(() => historyDecision(source, { ...additions, registry: [{ child_issue: 359, entry: oneSidedRegistry }] }, accepted), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_MISMATCH');
  const wrongAccepted = [{ pr_number: 901, candidate: candidate(901, 'e', 'f'), child_issue: 359, epoch_id: 'E3' }];
  assert.throws(() => historyDecision(source, additions, wrongAccepted), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH');
  assert.throws(() => historyDecision(source, additions, [{ pr_number: 901, candidate: prCandidate, child_issue: 360, epoch_id: 'E3' }]), (error) => error.code === 'HUMAN_HISTORY_CANDIDATE_BINDING_MISMATCH');
});

test('F4 complete-read dispatch fails closed for all reserved grammar errors', () => {
  const state = clone(programme.FINALISATION_STAGE_B_TARGET_STATE);
  const rendered = programme.renderHumanV2Parent(state);
  assert.equal(rendered.ok, true, rendered.code);
  const body = rendered.body;
  assertCode(programme.parseProgrammeBodyComplete({ body, complete: false }, { kind: 'parent' }), 'BODY_READ_INCOMPLETE');
  assertCode(programme.parseProgrammeBodyComplete({ body: body.replace(programme.HUMAN_V2_TOOLKIT_MARKERS.parent.end, '') }, { kind: 'parent' }), 'MARKER_PARTIAL');
  assertCode(programme.parseProgrammeBodyComplete({ body: body + body }, { kind: 'parent' }), 'MARKER_DUPLICATE');
  const nested = body.replace('\n' + programme.HUMAN_V2_TOOLKIT_MARKERS.parent.end, '\n' + programme.HUMAN_V2_TOOLKIT_MARKERS.parent.begin + '\n' + programme.HUMAN_V2_TOOLKIT_MARKERS.parent.end);
  assertCode(programme.parseProgrammeBodyComplete({ body: nested, complete: true }, { kind: 'parent' }), 'MARKER_NESTED');
  const child = programme.renderHumanV2Child(state, 359);
  assertCode(programme.parseProgrammeBodyComplete({ body: child.body, complete: true }, { kind: 'parent' }), 'MARKER_WRONG_KIND');
  const mixed = body.replace(programme.HUMAN_V2_TOOLKIT_MARKERS.parent.begin, programme.HUMAN_V2_MARKERS.parent.begin);
  assertCode(programme.parseProgrammeBodyComplete({ body: mixed, complete: true }, { kind: 'parent' }), 'MARKER_MIXED_NAMESPACE');
  assertCode(programme.parseProgrammeBodyComplete({ body: body.replaceAll('human-v2', 'human-v9'), complete: true }, { kind: 'parent' }), 'HUMAN_VERSION_UNSUPPORTED');
  assertCode(programme.parseProgrammeBodyComplete({ body: body.replaceAll('human-v2', 'human-v1'), complete: true }, { kind: 'parent' }), 'HUMAN_V1_UNSUPPORTED');
  const carrierOnly = carrierLine(body, programme.HUMAN_V2_TOOLKIT_MARKERS.parent.carrier);
  assertCode(programme.parseProgrammeBodyComplete({ body: carrierOnly, complete: true }, { kind: 'parent' }), 'CARRIER_OUTSIDE_BLOCK');
  const residue = 'notes MANAGED-PROGRAM-RESIDUE\n' + body;
  assertCode(programme.parseProgrammeBodyComplete({ body: residue, complete: true }, { kind: 'parent' }), 'RESERVED_RESIDUE_OUTSIDE_BLOCK');
  assertCode(programme.parseProgrammeBodyComplete({ body: 'MANAGED-PROGRAM-RESIDUE', complete: true }, { kind: 'parent' }), 'RESERVED_NAMESPACE_MALFORMED');
  assertCode(programme.parseProgrammeBodyComplete({ body: 42, complete: true }, { kind: 'parent' }), 'BODY_NOT_STRING');
  const legacy = programme.renderProgrammeV5(state);
  const legacyParsed = programme.parseProgrammeBodyComplete({ body: legacy.parent, complete: true }, { kind: 'parent' });
  assert.equal(legacyParsed.ok, true, legacyParsed.code + ' ' + legacyParsed.reason);
});

test('F5 PublicSurfaceCodec is the final injection and privacy boundary', () => {
  assert.match(programme.PublicSurfaceCodec.paragraph('<tag> & `code`'), /&lt;tag&gt; &amp; \\`code\\`/);
  assert.match(programme.PublicSurfaceCodec.heading('# heading'), /\\#/);
  assert.match(programme.PublicSurfaceCodec.tableCell('left|right'), /\\\|/);
  assert.match(programme.PublicSurfaceCodec.url('https://example.com/a?x=1&y=2'), /&amp;/);
  for (const value of ['api_key=value', 'password=value', 'C:\\Users\\private\\file.txt', 'file:///private/file.txt', '\ud800']) {
    assert.throws(() => programme.PublicSurfaceCodec.paragraph(value));
  }
  assertCode(programme.renderHumanV2Parent(genericState({ stateExtras: { credentials: { password: 'redact-me' } } })), 'HUMAN_PUBLIC_DATA_UNSAFE');
  assert.throws(() => programme.PublicSurfaceCodec.paragraph('Bearer abcdefghijklmnop'));
  assert.throws(() => programme.PublicSurfaceCodec.paragraph('ghp_1234567890abcdef'));
  for (const url of ['http://example.com', 'https://localhost/private', 'https://user:pass@example.com', 'https://example.com/?token=value']) {
    assert.throws(() => programme.PublicSurfaceCodec.url(url));
  }
  const injected = genericState();
  injected.children[1].summary = '<script>alert(1)</script> **bold**';
  const safe = programme.renderHumanV2Parent(injected);
  assert.equal(safe.ok, true, safe.code + ' ' + safe.reason);
  assert.doesNotMatch(safe.body, /<script>/i);
  assert.match(safe.body, /&lt;script&gt;/);
  const privateState = genericState();
  privateState.parent.title = 'C:\\Users\\private\\programme';
  const privateResult = programme.renderHumanV2Parent(privateState);
  assertCode(privateResult, 'HUMAN_PUBLIC_DATA_UNSAFE');
  const malformedState = genericState();
  malformedState.parent.title = '\ud800';
  assertCode(programme.renderHumanV2Parent(malformedState), 'HUMAN_PUBLIC_DATA_UNSAFE');
});

test('F6 global action machine cannot infer programme completion from incomplete gates', () => {
  const stageB = programme.renderHumanV2Parent(programme.FINALISATION_STAGE_B_TARGET_STATE);
  assert.equal(stageB.ok, true, stageB.code);
  assert.match(stageB.body, /AWAIT_EPOCH_AUTHORITY|E4 remains pending/);
  const acceptedButUnmerged = genericState({
    epochs: [{ id: 'P1', name: 'Build', purpose: 'Build the package.', terminal_disposition: 'ACCEPTED', evidence_ref: 'accepted' }],
    evidence_refs: [{ id: 'accepted', kind: 'WEB', reference: 'example:evidence:accepted', summary: 'The phase was accepted.' }],
  });
  const unmerged = programme.renderHumanV2Parent(acceptedButUnmerged);
  assert.equal(unmerged.ok, true, unmerged.code);
  assert.match(unmerged.body, /Await authoritative child finality/);
  assert.doesNotMatch(unmerged.body, /PROGRAMME_COMPLETE/);
  const amend = genericState({
    epochs: [{ id: 'P1', name: 'Build', purpose: 'Build the package.', terminal_disposition: 'AMEND', evidence_ref: 'amend' }],
    evidence_refs: [{ id: 'amend', kind: 'WEB', reference: 'example:evidence:amend', summary: 'The phase needs amendment.' }],
  });
  assert.match(programme.renderHumanV2Parent(amend).body, /Amend/);
  const rejectedEpoch = genericState({
    epochs: [{ id: 'P1', name: 'Build', purpose: 'Build the package.', terminal_disposition: 'REJECTED', evidence_ref: 'rejected' }],
    evidence_refs: [{ id: 'rejected', kind: 'WEB', reference: 'example:evidence:rejected', summary: 'The phase was rejected.' }],
  });
  const rejectedEpochResult = programme.renderHumanV2Parent(rejectedEpoch);
  assert.equal(rejectedEpochResult.ok, true, rejectedEpochResult.code + ' ' + rejectedEpochResult.reason);
  assert.match(rejectedEpochResult.body, /authorised replacement or disposition/i);
  assert.doesNotMatch(rejectedEpochResult.body, /PROGRAMME_COMPLETE/);
  const rejectedEntry = { accepted_evidence_ref: null, completes_child: false, epoch_id: 'P1', github_state: 'CLOSED', merged: false, pr: 99, retirement_evidence_ref: null, role: 'INTERMEDIATE', status: 'RETIRED' };
  const rejected = genericState({
    prRegistry: [{ ...rejectedEntry, status: 'REJECTED' }],
    prs: [descriptor(99, 'Rejected candidate disposition.', { child_issue: 73 })],
  });
  assert.match(programme.renderHumanV2Parent(rejected).body, /authorised replacement|disposition/i);
  const completedUnmerged = genericState();
  completedUnmerged.children[0].finality.state = 'UNMERGED';
  assertCode(programme.renderHumanV2Parent(completedUnmerged), 'CANONICAL_STATE_CONTRADICTORY');
  const completesEarly = genericState({
    prRegistry: [{ ...rejectedEntry, completes_child: true, pr: 99 }],
    prs: [descriptor(99, 'Premature completion claim.', { child_issue: 73 })],
  });
  assertCode(programme.renderHumanV2Parent(completesEarly), 'CANONICAL_STATE_CONTRADICTORY');
  const mergedMismatch = genericState({
    prRegistry: [{ ...rejectedEntry, merged: true, github_state: 'OPEN', pr: 99 }],
    prs: [descriptor(99, 'Mismatched provider disposition.', { child_issue: 73 })],
  });
  assertCode(programme.renderHumanV2Parent(mergedMismatch), 'CANONICAL_STATE_CONTRADICTORY');
});

test('F7 explicit child selection has no positional fallback and child-local action is independent', () => {
  const state = genericState();
  const missing = programme.selectChildIssue(state, 999);
  assertCode(missing, 'CHILD_NOT_FOUND');
  const selected = programme.selectChildIssue(state, 72);
  assert.equal(selected.ok, true, selected.code);
  assert.equal(selected.child_issue, 72);
  const current = programme.selectChildIssue(state);
  assert.equal(current.ok, true, current.code);
  assert.equal(current.child_issue, 73);
  const ambiguous = clone(state);
  ambiguous.children[0].lifecycle = 'CURRENT';
  assertCode(programme.selectChildIssue(ambiguous), 'CHILD_SELECTION_AMBIGUOUS');
  assertCode(programme.renderHumanV2Child(ambiguous), 'CHILD_SELECTION_AMBIGUOUS');
  const child = programme.renderHumanV2Child(state, 72);
  assert.equal(child.ok, true, child.code + ' ' + child.reason);
  assert.match(child.body, /complete and receives no current-child instruction/);
  assert.doesNotMatch(child.body, /Continue the active gate for child #73/);
  const verified = programme.verifyHumanV2Child({ body: child.body, complete: true }, state, 72);
  assert.equal(verified.ok, true, verified.code + ' ' + verified.reason);
});

test('F8 Toolkit boundaries remain visible while the generic renderer stays portable', () => {
  const toolkit = programme.renderHumanV2Parent(programme.FINALISATION_STAGE_B_TARGET_STATE);
  assert.equal(toolkit.ok, true, toolkit.code);
  assert.match(toolkit.body, /Web owns E4 authority|E4 remains pending|Programme Apply|Ready|merge|finality/i);
  const generic = programme.renderHumanV2Parent(genericState());
  assert.equal(generic.ok, true, generic.code + ' ' + generic.reason);
  const genericProse = generic.managed.split('\n').slice(1, -2).join('\n');
  assert.doesNotMatch(genericProse, /AI-AGENT-TOOLKIT|SQAG|Swooshz Platform|weijunswj\/ai-agent-toolkit|Programme Apply|E4/);
  const second = programme.renderHumanV2Parent(genericState());
  assert.equal(second.body, generic.body);
  assert.ok(generic.body.indexOf('| 1 | COMPLETED | #72 |') < generic.body.indexOf('| 2 | CURRENT | #73 |'));
  assert.ok(generic.body.indexOf('| 2 | CURRENT | #73 |') < generic.body.indexOf('| 3 | QUEUED | #74 |'));
});

test('positive legacy E3 matrix remains byte and digest exact for source, Stage A, and Stage B', () => {
  const cases = [
    ['source', programme.FINALISATION_SOURCE_STATE, programme.FINALISATION_SOURCE_RENDERED],
    ['stage-a', programme.FINALISATION_STAGE_A_TARGET_STATE, programme.FINALISATION_RENDERED_TARGETS.stage_a],
    ['stage-b', programme.FINALISATION_STAGE_B_TARGET_STATE, programme.FINALISATION_RENDERED_TARGETS.stage_b],
  ];
  for (const [label, state, expected] of cases) {
    const rendered = programme.renderProgrammeV5(state);
    assert.equal(rendered.ok, true, label + ': ' + rendered.code);
    assert.equal(rendered.parent, expected.parent, label + ' parent bytes');
    assert.equal(rendered.child, expected.child, label + ' child bytes');
    assert.equal(programme.digestValue(state), expected.canonical_digest, label + ' canonical digest');
    const expectedParentDigest = expected.parent_body_digest || (label === 'source' ? programme.FINALISATION_SOURCE_PARENT_BODY_DIGEST : undefined);
    const expectedChildDigest = expected.child_body_digest || (label === 'source' ? programme.FINALISATION_SOURCE_CHILD_BODY_DIGEST : undefined);
    assert.equal(programme.sha256Text(rendered.parent), expectedParentDigest, label + ' parent digest');
    assert.equal(programme.sha256Text(rendered.child), expectedChildDigest, label + ' child digest');
  }
});

test('human-v2 PR PRE_NUMBER and BOUND require the correct external descriptor and authority', () => {
  const preDescriptor = descriptor(null, 'Create the successor implementation PR.', {
    repository: 'weijunswj/ai-agent-toolkit', child_issue: 359,
    position: { parent: 240, child: 359, epoch: 'G3', gate: 'G3', role: 'INTERMEDIATE', completes_child: false },
    next_action: 'Return the exact PRE_NUMBER body for controller adjudication.',
  });
  const pre = programme.renderHumanV2Pr(preDescriptor, { number_state: 'PRE_NUMBER' });
  assert.equal(pre.ok, true, pre.code + ' ' + pre.reason);
  assert.equal(pre.number_state, 'PRE_NUMBER');
  assert.equal(pre.pr_number, null);
  assert.equal(pre.carrier.pr_number, null);
  assert.equal(pre.carrier.number_authority_digest, null);
  assert.match(pre.body, /- Number state: PRE/);
  assert.match(pre.body, /- Return the exact PRE/);
  const preVerified = programme.verifyHumanV2Pr({ body: pre.body, complete: true }, preDescriptor, { number_state: 'PRE_NUMBER' });
  assert.equal(preVerified.ok, true, preVerified.code + ' ' + preVerified.reason);
  const authority = { pr_number: 901, complete: true, source: 'controller', authority_digest: digest('b') };
  const boundDescriptor = { ...preDescriptor, number: 901, number_authority: authority };
  const bound = programme.renderHumanV2Pr(boundDescriptor, { number_state: 'BOUND', number_authority: authority });
  assert.equal(bound.ok, true, bound.code + ' ' + bound.reason);
  assert.equal(bound.number_state, 'BOUND');
  assert.equal(bound.pr_number, 901);
  assert.match(bound.body, /- Number state: BOUND\./);
  assert.match(bound.body, /- Continue only under the bound controller authority\./);
  assert.doesNotMatch(bound.body, /Return the exact PRE/);
  const boundIdentity = { ...boundDescriptor };
  boundIdentity.number = null;
  delete boundIdentity.number_authority;
  assert.deepEqual(boundIdentity, preDescriptor);
  assert.deepEqual(bound.candidate, pre.candidate);
  assert.equal(bound.carrier.candidate.digest, pre.carrier.candidate.digest);
  const boundParsed = programme.parseProgrammeBodyComplete(
    { body: bound.body, complete: true },
    { kind: 'pr', descriptor: boundDescriptor, number_state: 'BOUND', number_authority: authority },
  );
  assert.equal(boundParsed.ok, true, boundParsed.code + ' ' + boundParsed.reason);
  assert.equal(programme.verifyHumanV2Pr({ body: bound.body, complete: true }, boundDescriptor, { number_state: 'BOUND', number_authority: authority }).ok, true);
  assertCode(programme.renderHumanV2Pr(boundDescriptor, { number_state: 'BOUND', number_authority: { ...authority, complete: false } }), 'PR_NUMBER_AUTHORITY_REQUIRED');
  assertCode(programme.verifyHumanV2Pr({ body: bound.body, complete: true }, { ...boundDescriptor, purpose: 'Tampered purpose.' }, { number_state: 'BOUND', number_authority: authority }), 'DESCRIPTOR_DIGEST_MISMATCH');
});

test('digest domains, codec output, and complete-body bytes are distinct and deterministic', () => {
  const rendered = programme.renderHumanV2Parent(programme.FINALISATION_STAGE_B_TARGET_STATE, { prefix: 'unmanaged prefix\n', suffix: '\nunmanaged suffix' });
  assert.equal(rendered.ok, true, rendered.code + ' ' + rendered.reason);
  assert.equal(rendered.canonical_digest, programme.digestValue(programme.FINALISATION_STAGE_B_TARGET_STATE));
  assert.equal(rendered.carrier_digest, programme.digestValue(rendered.carrier));
  assert.equal(rendered.managed_block_bytes_digest, programme.sha256Text(rendered.managed));
  assert.equal(rendered.complete_body_bytes_digest, programme.sha256Text(rendered.body));
  const lines = rendered.managed.split('\n');
  const carrierIndex = lines.findIndex((line) => line.startsWith(programme.HUMAN_V2_TOOLKIT_MARKERS.parent.carrier));
  assert.equal(rendered.public_prose_bytes_digest, programme.sha256Text(lines.slice(1, carrierIndex).join('\n')));
  assert.notEqual(rendered.complete_body_bytes_digest, rendered.managed_block_bytes_digest);
  const parsed = programme.parseHumanV2Parent({ body: rendered.body, complete: true });
  assert.equal(parsed.ok, true, parsed.code + ' ' + parsed.reason);
  assert.equal(parsed.complete_body_bytes_digest, rendered.complete_body_bytes_digest);
});

test('HISTORY_EXTENDED_PRE_E4 target is renderable without moving lifecycle truth', () => {
  const source = clone(programme.FINALISATION_STAGE_B_TARGET_STATE);
  const prCandidate = candidate(901);
  const prDescriptor = descriptor(901, 'Retain a future candidate in immutable chronology.', { candidate: prCandidate });
  const entry = {
    accepted_evidence_ref: 'candidate-901', candidate: prCandidate, completes_child: false, draft: false,
    epoch_id: 'E3', github_state: 'OPEN', merged: false, pr: 901,
    retention_evidence_ref: null, retirement_evidence_ref: null, role: 'INTERMEDIATE', status: 'RETAINED',
  };
  const decision = historyDecision(source, {
    prs: [prDescriptor],
    registry: [{ child_issue: 359, entry }],
    evidence_refs: [{ id: 'candidate-901', kind: 'WEB', reference: 'example:evidence:901', summary: 'Candidate chronology is controller-defined.' }],
  }, [{ pr_number: 901, candidate: prCandidate, child_issue: 359, epoch_id: 'E3' }]);
  const target = programme.deriveHumanSurfaceHistoryTarget({ source, decision });
  assert.equal(target.ok, true, target.code + ' ' + target.reason);
  assert.equal(target.history_status, 'HISTORY_EXTENDED_PRE_E4');
  assert.equal(programme.validateHumanCanonicalState(target.target_state).ok, true);
  assert.equal(programme.validateHistoryOnlyDelta(source, target.target_state, decision).ok, true);
  assert.equal(target.target_state.children[1].lifecycle, source.children[1].lifecycle);
  assert.equal(target.target_state.children[1].epochs.length, source.children[1].epochs.length);
  assert.equal(target.target_state.children[1].pr_registry.length, source.children[1].pr_registry.length + 1);
  const parent = programme.renderHumanV2Parent(target.target_state);
  const child = programme.renderHumanV2Child(target.target_state, 359);
  assert.equal(parent.ok, true, parent.code + ' ' + parent.reason);
  assert.equal(child.ok, true, child.code + ' ' + child.reason);
  assert.equal(programme.parseHumanV2Parent({ body: parent.body, complete: true }).ok, true);
});

test('migration preparation and parent-first interruption recovery remain non-authoritative', () => {
  const state = programme.FINALISATION_STAGE_B_TARGET_STATE;
  const parent = programme.renderHumanV2Parent(state);
  const child = programme.renderHumanV2Child(state, 359);
  const prepared = programme.prepareHumanV2Migration({
    parent_complete_read: { body: parent.body, complete: true },
    child_complete_read: { body: child.body, complete: true }, child_issue: 359,
  });
  assert.equal(prepared.ok, true, prepared.code + ' ' + prepared.reason);
  assert.equal(prepared.transaction_state, 'HUMAN_V2_PREPARED');
  assert.equal(prepared.provider_cas_claim, false);
  assert.equal(prepared.automatic_rollback, false);
  const stale = programme.classifyHumanV2MigrationState('PARENT_HUMAN_V2_COMMITTED_CHILD_LEGACY_STALE');
  assert.equal(stale.ok, true, stale.code);
  assert.equal(stale.recoverable, true);
  const recoveredParentOnly = programme.recoverHumanV2Migration({
    transaction_state: 'PARENT_HUMAN_V2_COMMITTED_CHILD_LEGACY_STALE',
    parent_complete_read: { body: parent.body, complete: true }, child_issue: 359,
  });
  assert.equal(recoveredParentOnly.ok, true, recoveredParentOnly.code + ' ' + recoveredParentOnly.reason);
  assert.equal(recoveredParentOnly.child_write_required, true);
  const recovered = programme.recoverHumanV2Migration({
    transaction_state: 'PARENT_HUMAN_V2_COMMITTED_CHILD_LEGACY_STALE',
    parent_complete_read: { body: parent.body, complete: true },
    child_complete_read: { body: child.body, complete: true }, child_issue: 359,
  });
  assert.equal(recovered.ok, true, recovered.code + ' ' + recovered.reason);
  assert.equal(recovered.transaction_state, 'HUMAN_V2_RECONCILED');
  const drift = programme.recoverHumanV2Migration({
    transaction_state: 'PARENT_HUMAN_V2_COMMITTED_CHILD_LEGACY_STALE',
    parent_complete_read: { body: parent.body.replace('Current programme', 'drift'), complete: true }, child_issue: 359,
  });
  assertCode(drift, 'MIGRATION_PARENT_DRIFT');
});

test('schemas, facade exports, version surfaces, and explicit human-v1 reservation stay aligned', () => {
  const schemaFiles = [
    'github-program-reconciler/programme-state-v5.schema.json',
    'github-program-reconciler/programme-surface-contract-v5.json',
    'github-program-reconciler/human-surface-conformance-decision-v1.schema.json',
    'github-program-reconciler/human-surface-conformance-evidence-v1.schema.json',
    'github-program-reconciler/controller-bootstrap-v1.schema.json',
    'github-governance-review-reconciler/github-governance-review-reconciler-contract.schema.json',
    'github-governance-review-reconciler/github-governance-review-reconciler-policy.json',
    'github-governance-review-reconciler/tracker-v3-grammar.json',
  ];
  for (const relative of schemaFiles) JSON.parse(fs.readFileSync(path.join(contractRoot, relative), 'utf8'));
  const aligned = [
    '.codex-plugin/plugin.json', '.claude-plugin/plugin.json',
    'repo/contracts/toolkit-local-bridge/version.json',
    'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
    'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json',
  ];
  for (const relative of aligned) assert.equal(JSON.parse(fs.readFileSync(path.join(projectRoot, relative), 'utf8')).version, '2.10.9', relative);
  assert.equal(JSON.parse(fs.readFileSync(path.join(contractRoot, 'github-program-reconciler', 'programme-surface-contract-v5.json'), 'utf8')).presentation.version, 'human-v2');
  assert.equal(typeof governance.renderHumanV2Parent, 'function');
  assert.equal(typeof governance.parseProgrammeBodyComplete, 'function');
  assert.equal(typeof governance.programmeV5.deriveHumanSurfaceHistoryTarget, 'function');
  const source = programme.renderHumanV2Parent(programme.FINALISATION_STAGE_B_TARGET_STATE);
  assert.equal(source.ok, true);
  assertCode(programme.parseProgrammeBodyComplete({ body: source.body.replaceAll('human-v2', 'human-v1'), complete: true }, { kind: 'parent' }), 'HUMAN_V1_UNSUPPORTED');
});
