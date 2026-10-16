'use strict';

// Test-only V3 store fixture. Every authority, decision, lifecycle value, and evidence
// payload created here is synthetic; none represents owner UAT or a real reviewer run.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const authoritySupport = require('./toolkit-authority-packet-test-support.cjs');

const REPOSITORY = 'example/toolkit';
const PROGRAMME = 461;
const CHILD = 421;
const OWNER = 'owner-example';
const LANE = 'toolkit-v3-core-synthetic';
const FIXTURE_COMMIT = '70a775ae49f96e90da4a8f53f16522ce1d49b9bd';
const CANDIDATE = Object.freeze({
  pr_number: 461,
  branch: 'synthetic/toolkit-v3-core',
  base_ref: 'main',
  base_sha: 'c'.repeat(40),
  head_sha: 'a'.repeat(40),
  tree_sha: 'b'.repeat(40),
});

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// SHA-1 is required for Git blob object-ID compatibility;
// SHA-256 independently verifies content integrity.
// codeql[js/weak-cryptographic-algorithm]
const gitBlob = (bytes) => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
const clone = (value) => structuredClone(value);

function gitFile(repositoryRoot, relativePath) {
  const result = spawnSync('git', ['cat-file', 'blob', `${FIXTURE_COMMIT}:${relativePath}`], {
    cwd: repositoryRoot, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    throw new Error(`synthetic V3 fixture source is unavailable at checkpoint: ${relativePath}`);
  }
  return result.stdout;
}

function createSourceBank(repositoryRoot, currentStack = false, registryBytes = undefined) {
  if (registryBytes !== undefined && (!currentStack || !Buffer.isBuffer(registryBytes))) throw new Error('explicit current synthetic registry bytes required');
  const files = new Map([
    ['controller', 'repo/CONTROLLER.md'],
    ['architecture', 'repo/ARCHITECTURE.md'],
    ['registry', 'repo/contracts/controller-kernel/stack-registry-v3.json'],
    ['decision-schema', 'repo/contracts/controller-kernel/controller-decision-v1.schema.json'],
    ['requirements', 'repo/docs/TOOLKIT-V3.md'],
    ['packet-schema', 'repo/contracts/github-program-receipt/authority-packet-v3.schema.json'],
    ['routing-test', 'repo/tests/toolkit-v3-routing.test.cjs'],
    ['store-source', 'repo/scripts/toolkit-github-program-receipt.cjs'],
  ]);
  const bytesByName = new Map([...files].map(([name, sourcePath]) => [name,
    currentStack && ['registry','decision-schema'].includes(name)
      ? name === 'registry' && registryBytes !== undefined ? Buffer.from(registryBytes) : fs.readFileSync(path.join(repositoryRoot,name==='decision-schema'?'repo/contracts/controller-kernel/controller-decision-v2.schema.json':sourcePath))
      : gitFile(repositoryRoot, sourcePath)]));
  if (currentStack) files.set('decision-schema','repo/contracts/controller-kernel/controller-decision-v2.schema.json');
  const references = new Map();
  const reference = (name, suffix = '') => {
    const sourcePath = files.get(name);
    const bytes = bytesByName.get(name);
    const id = `synthetic-${name}${suffix ? `-${suffix}` : ''}`;
    const ref = Object.freeze({
      id,
      repository: REPOSITORY,
      revision: FIXTURE_COMMIT,
      path: sourcePath,
      content_sha256: sha256(bytes),
      blob_sha1: gitBlob(bytes),
    });
    references.set(id, { reference: ref, bytes });
    return ref;
  };
  return { reference, references, bytesByName };
}

function syntheticVerificationRequirements(additional = []) {
  if (!Array.isArray(additional) || additional.length > 8
    || additional.some(item => typeof item !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(item))
    || new Set(additional).size !== additional.length || additional.includes('synthetic-store-readback')) {
    throw new Error('synthetic V3 additional verification requirements must be unique bounded identifiers');
  }
  return ['synthetic-store-readback', ...additional];
}

function makeDecision(sourceBank, options = {}) {
  const renewalTransportFixture = options.renewalTransportFixture === true;
  const root = 'synthetic-toolkit-v3-core-root';
  const registry = sourceBank.reference('registry');
  const controller = sourceBank.reference('controller');
  const architecture = sourceBank.reference('architecture');
  const requirements = sourceBank.reference('requirements');
  const decisionSchema = sourceBank.reference('decision-schema');
  const packetSchema = sourceBank.reference('packet-schema');
  const routingTest = sourceBank.reference('routing-test');
  const storeSource = sourceBank.reference('store-source');
  const qualification = Object.fromEntries(compiler.CHEAP_QUALIFIERS.map((key) => [key, { status: 'POSITIVE', source: null }]));
  const current=typeof options.current_stack==='string';
  const profile = current ? options.current_stack : options.profile_id || 'owner-openai-default';
  const observation=sourceBank.references.get(registry.id);
  const snapshot=new (require('../scripts/toolkit-stack-selection.cjs').StackRegistrySnapshot)({ reference:registry, content_base64:observation.bytes.toString('base64'), historical:!current });
  const selection = compiler.resolveContinuousProfile(profile, qualification,snapshot,{historical:!current});
  const base = { commit: CANDIDATE.head_sha, tree: CANDIDATE.tree_sha };
  const allowPaths = ['src/synthetic-v3-fixture.cjs'];
  const verificationRequirements = syntheticVerificationRequirements(options.additionalVerificationRequirements);
  const decision = {
    schema: current?'toolkit.controller-decision.v2':'toolkit.controller-decision.v1',
    identity: {
      repository: REPOSITORY, programme: PROGRAMME, child: CHILD, stable_root: root,
      run: 'synthetic-v3-controller-run-421', lock: 'synthetic-v3-controller-lock-421', revision: 1, supersedes: null,
    },
    sources: {
      authority: requirements, controller, architecture, registry,
      requirements: [decisionSchema], base,
      custody: [packetSchema],
    },
    selection: {
      registry_version: 3, profile_id: selection.profile_id, builder_qualification: qualification,
      routes: selection.routes, ...(current?{reviewers:selection.reviewers,registry_digest:selection.registry_digest}:{}), discovery_bound: 0, helper_bound: 0, helper_depth: 1,
    },
    assurance: {
      policy: 'continuous-builder-v1', risk_classification: requirements,
      design_challenge_required: false, design_challenge: null, g3_review: 'PAIRED_REQUIRED',
      inherited_reviews: [], candidate_review: 'FRESH_INDEPENDENT_EXACT_CANDIDATE',
      final_audit: 'SEPARATE_PROGRAMME_FINAL_AUDIT',
    },
    authority: {
      approval: requirements, operations: ['READ', 'PATCH', 'VALIDATE', ...(renewalTransportFixture ? ['TURN'] : [])], targets: allowPaths,
      effect_ceiling: { source_writes: 0, validation_invocations: 2, helper_launches: 0, native_turns: renewalTransportFixture ? 1 : 0, candidate_submissions: 0 },
      lifetime: 'UNTIL_CHILD_DISPOSITION', issued_at: '2026-10-12T00:00:00.000Z', expires_at: null,
      revocations: [], successor_fit: controller,
    },
    accounting: {
      stable_root: root, debt: { kind: 'EXACT', count: 0, unknown_additional: false }, events: [],
      grant: requirements,
      remaining: { construction_cycles: 1, correction_cycles: 1, candidates: 1, helpers: 0, native_turns: renewalTransportFixture ? 1 : 0 },
      history_certificates: [decisionSchema], grant_id: 'synthetic-grant-421', first_admission_id: 'synthetic-admission-421',
    },
    construction: {
      allow_paths: allowPaths,
      restrictions: [{ path: allowPaths[0], restriction: 'synthetic fixture only; no execution or writes' }],
      releases: [storeSource], base, candidate_ceiling: 0,
    },
    verification: {
      requirements: verificationRequirements,
      cases: verificationRequirements.flatMap(requirement => ['NEGATIVE', 'POSITIVE'].map((kind) => ({
        id: verificationRequirements.length === 1 ? `synthetic-store-${kind.toLowerCase()}`
          : `synthetic-${requirement}-${kind.toLowerCase()}`,
        requirement, boundary: 'synthetic V3 checkpoint reader', kind,
        runner: { executable: 'node', argv: ['--version'], cwd: '.', id: 'synthetic-node-probe' },
        max_invocations: 1, timeout_ms: 1000, output_paths: [], source: routingTest,
      }))),
      trusted_producers: [controller], effect_oracles: ['synthetic-no-effects'], required_consumers: ['G1'],
    },
    recovery: {
      custody: [packetSchema], unresolved_dispatches: [], unresolved_effects: [], unresolved_publications: [],
      next_action: 'Continue only through this synthetic fixture.',
    },
  };
  return compiler.validateControllerDecision(decision);
}

function compileDecisionFixture(sourceBank, options = {}) {
  const decision = makeDecision(sourceBank, options);
  const decisionEvidence = [...compiler.decisionReferences(decision).values()].map((reference) => {
    const source = sourceBank.references.get(reference.id);
    if (!source) throw new Error(`missing synthetic controller source bytes: ${reference.id}`);
    return { reference, content_base64: source.bytes.toString('base64') };
  });
  return { decision, decisionEvidence, compiled: compiler.compileControllerDecision(decision, decisionEvidence) };
}

function buildSyntheticV3DecisionFixture(repositoryRoot = path.resolve(__dirname, '..', '..'), options = {}) {
  return compileDecisionFixture(createSourceBank(repositoryRoot,typeof options.current_stack==='string',options.current_registry_bytes), options);
}

function evidenceReference(id, bytes, repository = REPOSITORY, relativePath = 'synthetic/evidence.json') {
  return {
    id, kind: 'GIT_BLOB', repository, commit: CANDIDATE.head_sha, path: relativePath,
    blob: gitBlob(bytes), content_digest: sha256(bytes),
  };
}

function custody(evidenceId) {
  const core = { evidence_id: evidenceId, custody_id: `synthetic-custody-${evidenceId}`, retention_status: 'HELD' };
  return { ...core, custody_digest: receipt.digestValue(core) };
}

function sourceReference() {
  return {
    repository: REPOSITORY, issue_number: CHILD, comment_id: 8801, node_id: 'IC_kw_synthetic_owner_8801',
    author_login: OWNER, updated_at: '2026-10-12T00:00:00.000Z',
    body_digest: receipt.digestValue({ synthetic: true, purpose: 'authority-only test input' }),
  };
}

function routeFromDecision(compiled, stage = 'G1', role = 'BUILDER', reviewerId = null) {
  const selected = compiler.resolveControllerRole(compiled,role,reviewerId).route;
  return {
    schema: receipt.RECOVERY_CHECKPOINT_CONSUMER_SCHEMA_ID,
    run: 'synthetic-v3-current-run-421', lock: compiled.decision.identity.lock,
    scope_digest: 'e'.repeat(64), decision_digest: compiled.decision_digest,
    profile_id: compiled.selection.profile_id, requested_profile_id: compiled.selection.requested_profile_id,
    stage, role, provider: selected.provider, model: selected.model, reasoning: selected.reasoning,
    ...(compiled.decision.schema==='toolkit.controller-decision.v2'?{selection_schema:'toolkit.stack-selection.v1',reviewer_id:reviewerId,
      registry_digest:compiled.selection.registry_digest,registry_reference:compiled.selection.registry_reference}:{}),
  };
}

function controllerConsumerFromDecision(compiled, scopeDigest) {
  return {
    schema: receipt.RECOVERY_CONTROLLER_CONSUMER_SCHEMA_ID,
    run: 'synthetic-v3-current-controller-421', lock: compiled.decision.identity.lock,
    stage: 'WEB', role: 'WEB', scope_digest: scopeDigest, decision_digest: compiled.decision_digest,
  };
}

function checkpointRoute(route) {
  return {
    profile_id: route.profile_id, requested_profile_id: route.requested_profile_id,
    stage: route.stage, role: route.role, provider: route.provider, model: route.model, reasoning: route.reasoning,
    ...(route.selection_schema?{selection_schema:route.selection_schema,reviewer_id:route.reviewer_id,registry_digest:route.registry_digest,registry_reference:route.registry_reference}:{}),
  };
}

function lifecycleStateFor(decisionDigest, scopeDigest, candidate, options = {}, context = {}) {
  const supplied = options.lifecycleState;
  const state = typeof supplied === 'function' ? supplied(context) : supplied ? clone(supplied) : {
    schema: 'toolkit.v3.lifecycle.v1', decision_digest: decisionDigest, scope_digest: scopeDigest,
    candidate: clone(candidate), environment_digest: receipt.digestValue({ synthetic: true, environment: 'fixture-only' }),
    builder_session_id: 'synthetic-builder-session', criteria: ['synthetic-store-readback'], builder_evidence_ids: [], owner_evidence_ids: [],
    impact_evidence_id: null, controller_uat_evidence_id: null, review_packet_ids: [], custody_evidence_id: null,
    publication: { state: 'PENDING', pending_effects: [], evidence_id: null },
    integration_evidence_id: null, installation_evidence_id: null, programme_outcomes: [],
  };
  return Buffer.from(JSON.stringify(state), 'utf8');
}

function fixtureCheckpointResults(defaults, supplied) {
  if (supplied === undefined) return defaults;
  if (!Array.isArray(supplied) || supplied.length !== defaults.length) {
    throw new Error('synthetic V3 checkpoint result override must preserve the fixture result set');
  }
  return defaults.map((row, index) => {
    const value = supplied[index];
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'evidence_ids,result_id,status,summary'
      || value.result_id !== row.result_id || value.summary !== row.summary
      || receipt.canonicalSerialize(value.evidence_ids) !== receipt.canonicalSerialize(row.evidence_ids)
      || !['PASS', 'FAIL', 'UNRUN', 'BLOCKED'].includes(value.status)) {
      throw new Error('synthetic V3 checkpoint result override may only change a status on an existing row');
    }
    return { ...row, status: value.status };
  });
}

function buildPacket({ bindings, compiled, sourceBank, evidence, lifecycleEvidenceId, lifecycleBytes, retentionViewEvidenceId, checkpointResults, checkpointAction = 'CONTINUE', route,
  governanceEvidenceRefs, extraEvidenceRefs = [], nextActionRoute = route,
  checkpointScopeDigest = bindings.applicability.scope_digest }) {
  const contractBytes = Buffer.from('synthetic V3 recovery contract revision\n', 'utf8');
  const sourceBytes = Buffer.from('synthetic V3 source revision\n', 'utf8');
  const contractRef = evidenceReference('synthetic-contract-revision', contractBytes);
  const sourceRef = evidenceReference('synthetic-source-revision', sourceBytes, REPOSITORY, 'src/synthetic-v3-fixture.cjs');
  const decisionBytes = Buffer.from(JSON.stringify(compiled.decision), 'utf8');
  const decisionRef = evidenceReference('synthetic-controller-decision', decisionBytes, REPOSITORY, 'synthetic/controller-decision.json');
  const lifecycleRef = evidenceReference(lifecycleEvidenceId, lifecycleBytes, REPOSITORY, 'synthetic/v3-lifecycle-state.json');
  for (const [reference, bytes] of [[contractRef, contractBytes], [sourceRef, sourceBytes], [decisionRef, decisionBytes], [lifecycleRef, lifecycleBytes]]) {
    evidence.set(reference.id, { reference, bytes, custody: custody(reference.id) });
  }
  const checkpoint = receipt.sealRecoveryCheckpoint({
    schema: receipt.RECOVERY_CHECKPOINT_V3_SCHEMA_ID,
    programme: { repository: bindings.repository, parent_issue: bindings.parent_issue, child_issue: bindings.child_issue, lane_id: bindings.lane_id },
    release: {
      contract_revision: { evidence_id: contractRef.id, repository: contractRef.repository, commit: contractRef.commit,
        path: contractRef.path, blob: contractRef.blob, content_digest: contractRef.content_digest },
      source_revision: { evidence_id: sourceRef.id, repository: sourceRef.repository, commit: sourceRef.commit,
        path: sourceRef.path, blob: sourceRef.blob, content_digest: sourceRef.content_digest },
    },
    candidate: { kind: 'COMMIT', ...clone(bindings.candidate) },
    route: { profile_id: compiled.selection.profile_id, requested_profile_id: compiled.selection.requested_profile_id,
      stage: 'G0', role: 'DISCOVERY', ...compiled.selection.routes.DISCOVERY,
      ...(compiled.decision.schema==='toolkit.controller-decision.v2'?{selection_schema:'toolkit.stack-selection.v1',reviewer_id:null,registry_digest:compiled.selection.registry_digest,registry_reference:compiled.selection.registry_reference}:{}) },
    controller_decision_evidence_id: decisionRef.id,
    scope_authority: { scope_digest: checkpointScopeDigest, authority: clone(bindings.authority) },
    evidence_ids: [...evidence.keys()].sort(),
    custody_refs: [...evidence.keys()].sort().map(custody),
    environment: {
      os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
      node: process.versions.node, toolkit_version: '3.0.0', profile_id: compiled.selection.profile_id,
    },
    results: fixtureCheckpointResults([
      { result_id: 'synthetic-fixture-qualification', status: 'UNRUN', summary: 'Synthetic fixture check is represented as unrun; no live qualification occurred.', evidence_ids: [] },
      { result_id: 'v3-lifecycle-state', status: 'UNRUN', summary: 'Synthetic lifecycle snapshot is pending and contains no owner UAT or reviewer acceptance.', evidence_ids: [lifecycleEvidenceId] },
      ...(retentionViewEvidenceId ? [{ result_id: 'v3-retention-view', status: 'UNRUN', summary: 'Synthetic retained-reference manifest for read-only store retention coverage.', evidence_ids: [retentionViewEvidenceId] }] : []),
    ], checkpointResults),
    owner_acceptance: { disposition: 'PENDING', owner_login: OWNER, evidence_id: null },
    writer: { state: 'UNKNOWN', pending_effects: [], denials: [] },
    next_action: { action_id: 'synthetic-current-consumer', action: checkpointAction, route: checkpointRoute(nextActionRoute), evidence_ids: [sourceRef.id] },
  });
  return {
    schema: receipt.AUTHORITY_PACKET_V3_SCHEMA_ID,
    bindings,
    body: {
      verdict: 'HOLD', decision: 'Synthetic V3 store fixture with an explicitly pending lifecycle.', findings: [],
      qualifications: ['Synthetic evidence only; owner acceptance, UAT, review, publication, and installed qualification are pending.'],
      next_state: 'Use only to exercise production persistence and trusted readers.',
      sections: [
        { name: 'framing', text: 'Synthetic G0 fixture; no work or external effects were performed.' },
        { name: 'unknowns', text: 'Owner UAT and peer review remain pending.' },
        { name: 'evidence_questions', text: 'Re-read exact synthetic GIT_BLOB bytes through the production store.' },
        { name: 'stop_condition', text: 'Stop on any candidate, scope, CURRENT, or evidence drift.' },
      ],
      evidence_refs: [contractRef, sourceRef, decisionRef, lifecycleRef, ...extraEvidenceRefs, ...governanceEvidenceRefs]
        .sort((left, right) => left.id.localeCompare(right.id)),
      gate_contract_ir: null,
      recovery_checkpoint_v3: checkpoint,
    },
  };
}

function createV3StoreFixture(options = {}) {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const storeRoot = options.stateRoot || authoritySupport.stateRoot('toolkit-v3-store-test-');
  if (options.additionalTrustedReaders !== undefined
    && (!options.additionalTrustedReaders || typeof options.additionalTrustedReaders !== 'object'
      || Array.isArray(options.additionalTrustedReaders)
      || Object.values(options.additionalTrustedReaders).some(reader => typeof reader !== 'function'))) {
    throw new Error('synthetic V3 additional trusted readers must be an object of functions');
  }
  const storeOptions = {
    ...authoritySupport.options(storeRoot), repository: REPOSITORY, parent_issue: PROGRAMME, child_issue: CHILD,
  };
  const sourceBank = createSourceBank(repositoryRoot,typeof options.current_stack==='string',options.current_registry_bytes);
  const { decision, decisionEvidence, compiled } = compileDecisionFixture(sourceBank, options);
  const source = sourceReference();
  const candidate = clone(options.candidate || CANDIDATE);
  const scopeDigest = options.scope_digest || receipt.digestValue({ synthetic: true, candidate, child: CHILD });
  const controllerConsumer = options.controllerConsumer === true
    || options.consumerSchema === receipt.RECOVERY_CONTROLLER_CONSUMER_SCHEMA_ID;
  const route = controllerConsumer
    ? controllerConsumerFromDecision(compiled, scopeDigest)
    : routeFromDecision(compiled, options.stage || 'G1', options.role || 'BUILDER',options.reviewer_id ?? null);
  if (!controllerConsumer) route.scope_digest = scopeDigest;
  const nextActionRoute = options.nextActionRoute || (controllerConsumer
    ? routeFromDecision(compiled, options.next_action_stage || 'G2', options.next_action_role || (options.current_stack?'REVIEW':'REVIEW_SCOPE'),options.next_action_reviewer_id ?? (options.current_stack?compiled.selection.reviewers[0].reviewer_id:null))
    : route);
  const packetEvidence = new Map();
  const lifecycleEvidenceId = options.lifecycle_evidence_id || 'synthetic-v3-lifecycle-state';
  const retentionViewEvidenceId = options.retention_view_evidence_id || null;
  const extraEvidenceRefs = [];
  for (const item of options.extraEvidence || []) {
    if (!item || typeof item !== 'object' || !item.reference || !item.reference.id
      || !['GIT_BLOB', 'OWNER_UAT'].includes(item.reference.kind)
      || item.bytes === undefined) throw new Error('synthetic V3 extra evidence requires a typed reference and exact bytes');
    const reference = clone(item.reference);
    const bytes = Buffer.from(item.bytes);
    if (reference.kind === 'GIT_BLOB' && (reference.blob !== gitBlob(bytes) || reference.content_digest !== sha256(bytes))
      || reference.kind === 'OWNER_UAT' && reference.source?.body_digest !== sha256(bytes)) {
      throw new Error(`synthetic V3 extra evidence identity mismatch: ${reference.id}`);
    }
    if (packetEvidence.has(reference.id)) throw new Error(`duplicate synthetic V3 evidence id: ${reference.id}`);
    const entry = { reference, bytes, custody: custody(reference.id) };
    packetEvidence.set(reference.id, entry);
    extraEvidenceRefs.push(reference);
  }
  if (retentionViewEvidenceId && !packetEvidence.has(retentionViewEvidenceId)) {
    throw new Error('synthetic V3 retention view must reference admitted extra evidence');
  }
  const defaultDependencyId = options.dependency_id || 'synthetic-v3-current-consumer';
  const initialRequiredConsumers = [{ class: route.stage, dependency_id: defaultDependencyId, scope_digest: scopeDigest }];
  const bindings = {
    repository: REPOSITORY, parent_issue: PROGRAMME, child_issue: CHILD, lane_id: LANE, human_owner: OWNER,
    producer: { run: 'synthetic-v3-producer-421', lock: 'synthetic-v3-producer-lock-421', stage: 'G0', role: 'DISCOVERY' },
    authority: source,
    governance: clone(authoritySupport.governanceBinding(source, REPOSITORY).governance),
    candidate,
    applicability: { scope_digest: scopeDigest, required_consumers: initialRequiredConsumers, retain_through_child_finality: false,
      retain_through_candidate_finality: false },
  };
  const governanceSources = authoritySupport.governanceBinding(source, REPOSITORY).sources;
  const governanceEvidenceRefs = governanceSources.map((item) => ({
    id: item.id, kind: 'GIT_BLOB', repository: item.repository, commit: item.revision, path: item.path,
    blob: item.blob_sha1, content_digest: item.content_sha256,
  }));
  const governanceContents = authoritySupport.readGovernanceSources(
    authoritySupport.governanceBinding(source, REPOSITORY),
  ).source_contents;
  for (const item of governanceContents) {
    const reference = governanceEvidenceRefs.find((entry) => entry.id === item.source_id);
    if (!reference) throw new Error(`missing synthetic governance reference: ${item.source_id}`);
    const bytes = Buffer.from(item.content_base64, 'base64');
    if (gitBlob(bytes) !== reference.blob || sha256(bytes) !== reference.content_digest) {
      throw new Error(`synthetic governance source identity mismatch: ${item.source_id}`);
    }
    packetEvidence.set(reference.id, { reference, bytes, custody: custody(reference.id) });
  }
  const baseContext = { decision, compiled, scopeDigest, candidate: clone(candidate), bindings, route,
    nextActionRoute, extraEvidence: extraEvidenceRefs.map((reference) => ({ reference: clone(reference), bytes: Buffer.from(packetEvidence.get(reference.id).bytes) })) };
  const draftOptions = typeof options.lifecycleState === 'function' ? {} : options;
  let lifecycleBytes = lifecycleStateFor(compiled.decision_digest, scopeDigest, candidate, draftOptions, baseContext);
  const buildPrimary = () => buildPacket({ bindings, compiled, sourceBank, evidence: packetEvidence, lifecycleEvidenceId, lifecycleBytes,
    retentionViewEvidenceId, checkpointResults: options.checkpointResults, checkpointAction: options.checkpointAction, route,
    governanceEvidenceRefs, extraEvidenceRefs, nextActionRoute,
    checkpointScopeDigest: options.checkpoint_scope_digest || scopeDigest });
  let artifact = buildPrimary();
  const contextForExtras = { ...baseContext, primary: artifact, packetEvidence, extraEvidenceRefs,
    evidenceReference, custody, packetId: (packet) => receipt.authorityPacketIdentities(packet).packet_id };
  let extraPackets = typeof options.extraPackets === 'function' ? options.extraPackets(artifact, contextForExtras) : [];
  if (!Array.isArray(extraPackets)) throw new Error('synthetic V3 extraPackets factory must return an array');
  extraPackets = extraPackets.map((packet) => clone(packet));
  const allArtifacts = [artifact, ...extraPackets];
  if (options.dependency_ids !== undefined && (!Array.isArray(options.dependency_ids) || options.dependency_ids.length !== allArtifacts.length)) {
    throw new Error('synthetic V3 dependency_ids must provide one dependency for every packet');
  }
  const dependencyIds = options.dependency_ids ? [...options.dependency_ids] : [
    defaultDependencyId, ...extraPackets.map((_, index) => `synthetic-v3-peer-${index + 1}`),
  ];
  if (new Set(dependencyIds).size !== dependencyIds.length) throw new Error('synthetic V3 dependencies must be unique');
  const requiredConsumers = dependencyIds.map((dependency_id) => ({ class: route.stage, dependency_id, scope_digest: scopeDigest }));
  for (const packet of allArtifacts) {
    if (!packet?.bindings || packet.bindings.repository !== REPOSITORY || packet.bindings.parent_issue !== PROGRAMME
      || packet.bindings.child_issue !== CHILD || packet.bindings.lane_id !== LANE || packet.bindings.human_owner !== OWNER
      || receipt.canonicalSerialize(packet.bindings.candidate) !== receipt.canonicalSerialize(candidate)
      || packet.body?.recovery_checkpoint_v3?.controller_decision_evidence_id !== artifact.body.recovery_checkpoint_v3.controller_decision_evidence_id) {
      throw new Error('synthetic V3 extra packets must share the primary namespace, candidate, and controller-decision evidence');
    }
    packet.bindings.applicability.required_consumers = clone(requiredConsumers);
  }
  const dependencyContext = { ...contextForExtras, primary: artifact, extraPackets, dependencyIds: [...dependencyIds],
    requiredConsumers: clone(requiredConsumers), extraPacketIds: extraPackets.map((packet) => receipt.authorityPacketIdentities(packet).packet_id) };
  if (typeof options.lifecycleState === 'function') {
    lifecycleBytes = lifecycleStateFor(compiled.decision_digest, scopeDigest, candidate, options, dependencyContext);
    artifact = buildPrimary();
    artifact.bindings.applicability.required_consumers = clone(requiredConsumers);
    allArtifacts[0] = artifact;
  }
  const packetById = new Map();
  let activeArtifact = artifact;
  let currentProjection = null;
  let currentBodyDigest = receipt.digestValue({ synthetic: true, current: 'synthetic V3 store fixture' });
  let currentRevision = 1;
  const baseReaders = authoritySupport.readers(artifact, {
    readCandidate: (input) => options.readerOverrides?.readCandidate?.(input, clone(options.observedCandidate || candidate))
      || clone(options.observedCandidate || candidate),
    readCurrent: () => ({ current: clone(currentProjection), projection_digest: receipt.digestValue(currentProjection),
      body_digest: currentBodyDigest, revision: currentRevision }),
    readRecoveryEvidence: (request) => {
      const entry = packetEvidence.get(request.reference.id);
      if (!entry) throw Object.assign(new Error('synthetic evidence unavailable'), { code: 'GPR_PACKET_AUTHORITY_UNVERIFIED', packet_boundary: true });
      const observed = options.readerOverrides?.readRecoveryEvidence?.(request, clone(entry));
      if (observed) return observed;
      return { evidence_id: entry.reference.id, reference_digest: receipt.digestValue(entry.reference),
        content_base64: entry.bytes.toString('base64'), custody_id: request.custody.custody_id, custody_status: 'HELD' };
    },
    readControllerEvidence: (request) => {
      const output = request.references.map((reference) => {
        const entry = decisionEvidence.find((item) => item.reference.id === reference.id);
        if (!entry || receipt.canonicalSerialize(entry.reference) !== receipt.canonicalSerialize(reference)) {
          throw Object.assign(new Error('synthetic controller source mismatch'), { code: 'GPR_PACKET_AUTHORITY_UNVERIFIED', packet_boundary: true });
        }
        return { reference: clone(reference), content_base64: entry.content_base64 };
      });
      return options.readerOverrides?.readControllerEvidence?.(request, output) || output;
    },
    readV3LifecycleObservation: (request) => {
      const observation = {
        decision_digest: request.decision_digest, candidate: clone(request.candidate),
        environment_digest: lifecycleStateDigestFromBytes(lifecycleBytes),
        evidence_digests: { [lifecycleEvidenceId]: request.lifecycle_reference_digest },
        result_observations: {}, required_outcome_ids: [], controller_evidence_ids: [], review_sessions: [],
      };
      const result = options.readerOverrides?.readV3LifecycleObservation?.(request, observation) || observation;
      return result;
    },
    readDispatchOutcome: (input) => ({
      admission_id: input.admission_id, consumer_key: input.consumer_key, intent_event_id: input.intent_event_id,
      attempt: input.attempt, transport_id: input.transport_id,
      transport_digest: input.transport_digest || receipt.digestValue({ synthetic: true, input }),
      outcome: input.status || 'not-started', delayed_completion_excluded: true,
    }),
  });
  function persistedPacket(value) {
    const packet = value?.packet || value;
    if (!packet || typeof packet !== 'object') return activeArtifact;
    const id = value?.packet_id || receipt.authorityPacketIdentities(packet).packet_id;
    return packetById.get(id) || packet;
  }
  function syntheticScreen(packetValue) {
    const packet = persistedPacket(packetValue);
    const identity = receipt.authorityPacketIdentities(packet);
    const output = {
      packet_digest: identity.packet_digest, decision: 'ALLOW',
      policy_digest: receipt.digestValue('synthetic-v3-store-screening-policy'),
      retention_policy_digest: receipt.digestValue('synthetic-v3-store-retention-policy'),
    };
    return options.readerOverrides?.screenPacket?.(packetValue, clone(output)) || output;
  }
  function syntheticWebDecision(input) {
    const packet = persistedPacket(input);
    const identity = receipt.authorityPacketIdentities(packet);
    const output = {
      packet_id: identity.packet_id, packet_digest: identity.packet_digest, binding_digest: identity.binding_digest,
      web_source: clone(packet.bindings.authority), disposition: 'ACCEPTED_FOR_CONSUMPTION',
      permitted_consumers: clone(requiredConsumers), applicability: clone(packet.bindings.applicability), successor_applicability: [],
    };
    return options.readerOverrides?.readWebDecision?.(input, clone(output)) || output;
  }
  const readers = {
    ...baseReaders,
    ...options.additionalTrustedReaders,
    readAuthority: (input) => {
      const packet = packetById.get(input?.packet_id) || activeArtifact;
      const bindingsForPacket = packet.bindings;
      const observed = {
        authority: clone(bindingsForPacket.authority), required_consumers: clone(requiredConsumers),
        governance_binding: authoritySupport.governanceBinding(bindingsForPacket.authority, bindingsForPacket.repository),
        producer_authority: { lane_id: bindingsForPacket.lane_id, human_owner: bindingsForPacket.human_owner,
          producer: clone(bindingsForPacket.producer) },
        completion_applicability: {
          schema: 'toolkit.github-program.semantic-completion-applicability.v1',
          scope_digest: bindingsForPacket.applicability.scope_digest, candidate: clone(bindingsForPacket.candidate),
          required_consumers: [], retain_through_child_finality: false, retain_through_candidate_finality: false,
        },
        later_controlling_comments: [],
      };
      return options.readerOverrides?.readAuthority?.(input, clone(observed)) || observed;
    },
    screenPacket: syntheticScreen,
    readWebDecision: syntheticWebDecision,
  };
  const store = receipt.initialiseAuthorityPacketStore(storeOptions, readers);
  const persistedPackets = [];
  for (const packet of allArtifacts) {
    activeArtifact = packet;
    const packetId = receipt.authorityPacketIdentities(packet).packet_id;
    packetById.set(packetId, packet);
    const persisted = store.persistAuthorityPacket(packet, authoritySupport.producerAdmission(packet));
    const storedPacket = store.readAuthorityPacket(persisted.packet_id, packet.bindings);
    packetById.set(persisted.packet_id, storedPacket);
    store.bindWebPacketAcceptance(persisted.packet_id, readers);
    persistedPackets.push({ ...persisted, packet: storedPacket });
  }
  activeArtifact = persistedPackets[0].packet;
  const predecessors = persistedPackets.map((entry, index) => ({ packet_id: entry.packet_id, dependency_id: dependencyIds[index] }));
  currentProjection = store.buildCurrentPacketProjection({
    ...(options.current_stack?{stack_selection:{schema:'toolkit.controller.stack-context.v1',registry_reference:compiled.selection.registry_reference,registry_digest:compiled.selection.registry_digest,profile_id:compiled.selection.profile_id,question:null}}:{}),
    repository: REPOSITORY, parent_issue: PROGRAMME, child_issue: CHILD, lane_id: LANE, human_owner: OWNER,
    consumer: route,
    candidate: clone(candidate),
    execution_binding: {
      semantic_run: null, receipt_run_id: null, loop_run_id: 'synthetic-v3-loop-run-421',
      repository_id: receipt.digestValue({ synthetic: true, repository: REPOSITORY }),
      authorized_ref_digest: receipt.digestValue({ synthetic: true, authority: source }),
      current_authority_digest: receipt.digestValue({ synthetic: true, current_authority: source }),
    },
    predecessors,
    operation: route.stage,
  }, readers);
  currentBodyDigest = receipt.digestValue(currentProjection);
  store.confirmCurrentPacketProjection(currentProjection, readers);
  const consumerIntent = {
    ...(options.current_stack?{stack_selection:{schema:'toolkit.controller.stack-context.v1',registry_reference:compiled.selection.registry_reference,registry_digest:compiled.selection.registry_digest,profile_id:compiled.selection.profile_id,question:null}}:{}),
    repository: REPOSITORY, parent_issue: PROGRAMME, child_issue: CHILD, lane_id: LANE, human_owner: OWNER,
    consumer: route, candidate: clone(candidate),
    execution_binding: {
      semantic_run: null, receipt_run_id: null, loop_run_id: 'synthetic-v3-loop-run-421',
      repository_id: receipt.digestValue({ synthetic: true, repository: REPOSITORY }),
      authorized_ref_digest: receipt.digestValue({ synthetic: true, authority: source }),
      current_authority_digest: receipt.digestValue({ synthetic: true, current_authority: source }),
    },
    predecessors,
    operation: route.stage,
  };
  const admissionResult = store.admitSemanticGate(consumerIntent, readers);
  return {
    store, admission: admissionResult.admission, admissionResult, storeOptions, storeRoot,
    artifact, packet: artifact, packet_id: persistedPackets[0].packet_id, packetId: persistedPackets[0].packet_id,
    persisted: persistedPackets[0], persistedPackets, packets: persistedPackets.map((entry) => entry.packet), extraPackets,
    compiled, compiledDecision: compiled, decision,
    decisionEvidence, lifecycleBytes, get currentProjection() { return currentProjection; }, consumerIntent,
    consumer: route, controllerConsumer, lifecycleOnly: controllerConsumer || extraPackets.length > 0,
    trustedReaders: readers, evidence: packetEvidence, dependencies: [...dependencyIds],
    readCurrentRecoveryCheckpoint() { return receipt.readCurrentRecoveryCheckpoint(store, admissionResult.admission); },
    readControllerDecision() { return store.readControllerDecision(admissionResult.admission); },
    readV3Lifecycle() { return store.readV3Lifecycle(admissionResult.admission); },
    setObservedCandidate(candidate) { options.observedCandidate = clone(candidate); },
    setCurrentObservation(value, { bodyDigest, revision } = {}) {
      currentProjection = clone(value?.current || value?.projection || value);
      if (bodyDigest !== undefined) currentBodyDigest = bodyDigest;
      if (revision !== undefined) currentRevision = revision;
    },
    setEvidenceBytes(evidenceId, bytes) {
      const entry = packetEvidence.get(evidenceId);
      if (!entry) throw new Error(`unknown synthetic V3 fixture evidence: ${evidenceId}`);
      entry.bytes = Buffer.from(bytes);
    },
  };
}

function lifecycleStateDigestFromBytes(bytes) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch (_) { return receipt.digestValue({ synthetic: true, invalid: true }); }
  return parsed.environment_digest;
}

module.exports = {
  CANDIDATE: clone(CANDIDATE),
  FIXTURE_COMMIT,
  makeDecision,
  buildSyntheticV3DecisionFixture,
  createV3StoreFixture,
  evidenceReference,
};
