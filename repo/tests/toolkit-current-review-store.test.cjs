'use strict';
// Current-stack synthetic full-scope reviews traverse actual SQLite publication,
// CURRENT admission, source recovery and independent lifecycle observation.
// These records establish controlled software behavior, never owner UAT/native G2.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const receipt=require('../scripts/toolkit-github-program-receipt.cjs'),finality=require('../scripts/toolkit-assurance-web-finality.cjs');
const support=require('./toolkit-v3-store-test-support.cjs'),lifecycle=require('../scripts/toolkit-v3-lifecycle.cjs');
const candidate=support.CANDIDATE,environment=receipt.digestValue('synthetic isolated environment');
const additionalVerificationRequirements=['synthetic-owner-visible-outputs'];
function currentFixture(stack,options={}) {
 const compiled=support.buildSyntheticV3DecisionFixture(undefined,{current_stack:stack,current_registry_bytes:options.current_registry_bytes,additionalVerificationRequirements}).compiled;
 const criteria=[...compiled.decision.verification.requirements];
function blob(id, value) { const bytes = Buffer.from(JSON.stringify(value)); return { reference: support.evidenceReference(id, bytes), bytes }; }
function resultsFor(candidateValue) {
  return Object.fromEntries(['builder', 'custody', 'publication', 'integration', 'installation', 'programme'].map(kind => [kind, {
    schema: 'toolkit.v3.result.v1', kind, decision_digest: compiled.decision_digest,
    candidate: structuredClone(candidateValue), environment_digest: environment, state: 'PASS'
  }]));
}
function ownerEvidence(id, candidateValue, coverage, commentId) {
  const bytes = Buffer.from(JSON.stringify({ schema: 'toolkit.v3.owner-uat.v1', disposition: 'ACCEPTED',
    candidate: structuredClone(candidateValue), environment_digest: environment, criteria: [...coverage] }));
  return { reference: { id, kind: 'OWNER_UAT', source: {
    repository: 'example/toolkit', issue_number: 421, comment_id: commentId, node_id: `IC_synthetic_${id}`,
    author_login: 'owner-example', updated_at: '2026-10-12T12:00:00.000Z',
    body_digest: crypto.createHash('sha256').update(bytes).digest('hex') } }, bytes };
}
function changedCandidate() { return { ...candidate, head_sha: '9'.repeat(40), tree_sha: '8'.repeat(40) }; }
function changedUatEvidence(candidateValue, options = {}) {
  const mode = options.mode;
  if (!['retained', 'partial', 'full'].includes(mode)) throw new Error('synthetic UAT scenario mode is required');
  const prior = ownerEvidence('synthetic-owner-uat', options.priorCandidate || candidate,
    options.priorCriteria || criteria, 99123);
  const changedDimensions = mode === 'retained' ? [] : mode === 'partial' ? ['recovery'] : ['outputs', 'recovery'];
  const affectedCriteria = mode === 'partial' ? [criteria[0]] : [];
  const impactValue = {
    accepted_candidate: structuredClone(options.priorCandidate || candidate),
    candidate: structuredClone(options.impactCandidate || candidateValue),
    changed_dimensions: changedDimensions, affected_criteria: affectedCriteria,
    targeted_verification_evidence_ids: options.targetedEvidenceIds || ['synthetic-builder'],
    earlier_evidence_invalid: false, cross_cutting: mode === 'full', investigation_complete: true
  };
  const impact = blob(`synthetic-uat-impact-${mode}`, impactValue);
  const status = lifecycle.classifyUatImpact(impactValue);
  const controller = blob(`synthetic-uat-controller-${mode}`, {
    schema: 'toolkit.v3.uat-applicability.v1', decision_digest: compiled.decision_digest,
    impact_evidence_id: impact.reference.id, status: options.controllerStatus || status,
    candidate: structuredClone(candidateValue)
  });
  const currentOwner = mode === 'partial' && options.includeCurrentOwner !== false
    ? ownerEvidence('synthetic-owner-uat-partial', candidateValue, [criteria[0]], 99124)
    : mode === 'full' && options.includeCurrentOwner === true
      ? ownerEvidence('synthetic-owner-uat-full', candidateValue, criteria, 99125) : null;
  const evidence = [prior, ...(currentOwner ? [currentOwner] : []), impact, controller];
  return {
    evidence, ownerEvidenceIds: evidence.filter(item => item.reference.kind === 'OWNER_UAT').map(item => item.reference.id),
    impactEvidenceId: impact.reference.id, controllerEvidenceId: controller.reference.id,
    controllerEvidenceIds: options.controllerEvidenceVisible === false ? [] : [controller.reference.id]
  };
}
function fixture(options = {}) {
  let peers = [], admittedPeerIds = [], observations;
  const candidateValue = options.candidate || candidate;
  const results = resultsFor(candidateValue);
  const uat = options.uat ? changedUatEvidence(candidateValue, options.uat) : null;
  const originalOwner = ownerEvidence('synthetic-owner-uat', candidate, criteria, 99123);
  const extra = [...Object.entries(results).map(([kind, value]) => blob('synthetic-'+kind, value)),
    ...(uat ? uat.evidence : [originalOwner])];
  const stateFactory = ctx => { admittedPeerIds = ctx.extraPacketIds || []; return ({ schema: 'toolkit.v3.lifecycle.v1', decision_digest: ctx.compiled.decision_digest,
    scope_digest: ctx.scopeDigest, candidate: ctx.candidate, environment_digest: environment,
    builder_session_id: 'synthetic-builder-session', criteria, builder_evidence_ids: ['synthetic-builder'],
    owner_evidence_ids: uat ? uat.ownerEvidenceIds : ['synthetic-owner-uat'],
    impact_evidence_id: uat?.impactEvidenceId || null, controller_uat_evidence_id: uat?.controllerEvidenceId || null,
    review_packet_ids: ctx.extraPacketIds || [],
    custody_evidence_id: 'synthetic-custody', publication: { state: options.publication || 'CURRENT',
      pending_effects: options.publication ? [{ effect_id: 'synthetic-pending-write', effect_digest: 'f'.repeat(64), state: 'UNKNOWN' }] : [],
      evidence_id: options.publication ? null : 'synthetic-publication' },
    integration_evidence_id: options.integration === false ? null : 'synthetic-integration',
    installation_evidence_id: 'synthetic-installation', programme_outcomes: [{ id: 'synthetic-core-outcome', state: 'COMPLETE', evidence_id: 'synthetic-programme' }] }); };
  const current = support.createV3StoreFixture({ current_stack:stack, current_registry_bytes:options.current_registry_bytes, controllerConsumer: true, candidate: candidateValue,
    additionalVerificationRequirements, extraEvidence: extra, lifecycleState: stateFactory,
    extraPackets(primary, ctx) {
      const roster=options.members || ctx.compiled.selection.reviewers.map(m=>m.reviewer_id);
      peers = roster.map((reviewer_id, index) => {
        const role='REVIEW', route=require('../scripts/toolkit-gate-contract-compiler.cjs').resolveControllerRole(ctx.compiled,role,reviewer_id).route;
        const packet = structuredClone(primary), checkpoint = packet.body.recovery_checkpoint_v3;
        packet.bindings.producer = { run: 'synthetic-review-'+index, lock: 'synthetic-review-lock-'+index, stage: 'G2', role, reviewer_id };
        const review = { schema: 'toolkit.v3.review.v2', reviewer_id, decision_digest: ctx.compiled.decision_digest, candidate: structuredClone(ctx.candidate),
          environment_digest: environment, role, route, session_id: 'synthetic-review-session-'+index,
          builder_session_id: 'synthetic-builder-session', origin: options.correction ? 'CORRECTION' : 'FRESH',
          previous_review_digest: options.correction ? receipt.digestValue('synthetic-previous-review-'+index) : null,
          coverage: [...criteria], findings: [], validation_evidence_ids: ['synthetic-builder'] };
        if(options.modifyReview) options.modifyReview(review,index);
        packet.body.verdict = 'PASS';
        packet.body.sections = ['candidate_identity', 'coverage', 'findings_and_reproducers', 'validation_results', 'disposition']
          .map(name => ({ name, text: name === 'disposition' ? receipt.canonicalSerialize(review) : 'Synthetic '+name }));
        const unsigned = Object.fromEntries(Object.entries(checkpoint).filter(([name]) => !['checkpoint_id', 'checkpoint_digest'].includes(name)));
        // Peer IDs do not recursively contain the lifecycle record that references them.
        const lifecycleId = checkpoint.results.find(row => row.result_id === 'v3-lifecycle-state').evidence_ids[0];
        packet.body.evidence_refs = packet.body.evidence_refs.filter(ref => ref.id !== lifecycleId);
        unsigned.evidence_ids = unsigned.evidence_ids.filter(id => id !== lifecycleId);
        unsigned.custody_refs = unsigned.custody_refs.filter(ref => ref.evidence_id !== lifecycleId);
        unsigned.results = unsigned.results.filter(row => row.result_id !== 'v3-lifecycle-state');
        unsigned.route = { profile_id: ctx.compiled.selection.profile_id, requested_profile_id: ctx.compiled.selection.requested_profile_id,
          stage: 'G2', role, ...route, reviewer_id, selection_schema:'toolkit.stack-selection.v1',
          registry_digest:ctx.compiled.selection.registry_digest,registry_reference:ctx.compiled.selection.registry_reference };
        packet.body.recovery_checkpoint_v3 = receipt.sealRecoveryCheckpoint(unsigned);
        return packet;
      });
      return peers;
    }, readerOverrides: { readV3LifecycleObservation(request, base) {
      const resultObservations = Object.fromEntries(Object.entries(results).map(([kind, value]) => ['synthetic-'+kind, value]));
      const evidenceDigests = Object.fromEntries(extra.map(item => [item.reference.id, receipt.digestValue(item.reference)]));
      const sessions = peers.map((packet, index) => {
        const review = JSON.parse(packet.body.sections.at(-1).text);
        return { reviewer_id:review.reviewer_id, packet_id: admittedPeerIds[index], review_digest: lifecycle.digest(review),
          session_id: review.session_id, builder_session_id: review.builder_session_id, route: review.route,
          previous_review_digest: review.previous_review_digest, independent_from_builder: true,
          peer_verdict_consumed: false, implemented_candidate: false, context_available: true };
      });
      observations = { ...base, evidence_digests: { ...base.evidence_digests, ...evidenceDigests },
        result_observations: resultObservations, required_outcome_ids: ['synthetic-core-outcome'],
        controller_evidence_ids: uat?.controllerEvidenceIds || [], review_sessions: sessions };
      return options.observe ? options.observe(structuredClone(observations)) : observations;
    } } });
  return current;
}

 return fixture(options);
}

for(const [stack,count] of [['owner-gpt',1],['owner-claude',1],['owner-mixed-claude-gpt',2]]) test(stack+' complete independent full-scope set is recovered from actual persisted source-bound packets',()=>{
 const f=currentFixture(stack);
 assert.equal(f.currentProjection.stack_selection.profile_id,stack);
 const selected=f.readControllerDecision();
 const state=finality.evaluateV3Finality(f.store,f.admission);
 assert.equal(state.code,undefined);assert.equal(state.g2,'REVIEW_SET_ACCEPTED');assert.equal(state.core,'CORE_RELEASE_DONE');
 assert.equal(f.compiled.selection.reviewers.length,count);assert.equal(state.mutation_authority,false);
 assert.equal(selected.selection.profile_id,stack);assert.deepEqual(selected.selection.reviewers,f.compiled.selection.reviewers);
});
for(const [name,options] of [
 ['missing',{members:['sol']}],['duplicate',{members:['sol','sol']}],['foreign',{members:['foreign']}],
 ['wrong route',{modifyReview(r){r.route.reasoning='low';}}],['wrong identity',{modifyReview(r){r.reviewer_id='foreign';}}],
 ['duplicate session',{modifyReview(r){r.session_id='same';}}],['builder session',{modifyReview(r){r.session_id=r.builder_session_id;}}],
 ['stale candidate',{modifyReview(r){r.candidate.head_sha='9'.repeat(40);}}],['partial scope',{modifyReview(r){r.coverage=r.coverage.slice(1);}}],
 ['fake PASS',{modifyReview(r){r.validation_evidence_ids=[];}}],['blocking finding',{modifyReview(r){r.findings=[{id:'blocker',disposition:'BLOCKING'}];}}],
 ['peer verdict',{observe(o){o.review_sessions[0].peer_verdict_consumed=true;return o;}}],
 ['lost context',{observe(o){o.review_sessions[0].context_available=false;return o;}}],
 ['missing session',{observe(o){o.review_sessions.pop();return o;}}],
 ['wrong attestation member',{observe(o){o.review_sessions[0].reviewer_id='foreign';return o;}}],
 ['premature integration',{integration:false}],['unpublished acceptance',{publication:'PENDING'}]
]) test('current review-set rejects '+name+' without granting release',()=>{
 let state;try { const f=currentFixture(['missing','duplicate session'].includes(name)?'owner-mixed-claude-gpt':'owner-gpt',options);state=finality.evaluateV3Finality(f.store,f.admission); }
 catch(error){assert.equal(name,'foreign');assert.match(error.message,/unadmitted review member/);return;}
 const expectedCode={duplicate:'V3_REVIEW_SET_INVALID','wrong route':'V3_REVIEW_UNVERIFIED','wrong identity':'V3_REVIEW_SET_INVALID',
  'duplicate session':'V3_REVIEW_UNVERIFIED','builder session':'V3_REVIEW_UNVERIFIED','stale candidate':'V3_REVIEW_UNVERIFIED',
  'partial scope':'V3_REVIEW_UNVERIFIED','fake PASS':'V3_REVIEW_UNVERIFIED','peer verdict':'V3_REVIEW_UNVERIFIED',
  'lost context':'V3_REVIEW_UNVERIFIED','missing session':'V3_REVIEW_INDEPENDENCE_UNVERIFIED','wrong attestation member':'V3_REVIEW_UNVERIFIED'}[name];
 assert.equal(state.code,expectedCode);
 assert.equal(state.core,'INCOMPLETE');assert.equal(state.mutation_authority,false);
});
test('current complete review set cannot be substituted by the historical single continuous/G4 consumer',()=>{
 const f=currentFixture('owner-claude');const state=finality.evaluateContinuousAssurance(f.store,f.admission);
 assert.equal(state.g2,'REVIEW_SET_ACCEPTED');assert.equal(state.mutation_authority,false);
});

test('changed captured route traverses persisted CURRENT, recovery, IR and native preparation with no active hot swap',()=>{
 const fs=require('node:fs'),path=require('node:path'),compiler=require('../scripts/toolkit-gate-contract-compiler.cjs');
 const native=require('../scripts/toolkit-codex-agent-adapter.cjs'),helper=require('../scripts/toolkit-v3-native-helper-adapter.cjs');
 const selection=require('../scripts/toolkit-stack-selection.cjs');
 const registry=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../contracts/controller-kernel/stack-registry-v3.json')));
 const original=support.buildSyntheticV3DecisionFixture(undefined,{current_stack:'owner-gpt'}).compiled;
 registry.profiles['owner-gpt'].routes.BUILDER.reasoning='xhigh';
 registry.profiles['owner-gpt'].routes.BUILDER_HELPER.reasoning='high';
 registry.profiles['owner-gpt'].reviewers[0].reasoning='high';
 const bytes=Buffer.from(JSON.stringify(registry));
 const f=currentFixture('owner-gpt',{current_registry_bytes:bytes}),recovered=f.readControllerDecision();
 assert.equal(recovered.selection.registry_digest,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.equal(f.currentProjection.stack_selection.registry_digest,recovered.selection.registry_digest);
 assert.equal(compiler.resolveControllerRole(recovered,'BUILDER').route.reasoning,'xhigh');
 assert.equal(compiler.resolveControllerRole(recovered,'REVIEW','sol').route.reasoning,'high');
 assert.equal(compiler.resolveControllerRole(original,'BUILDER').route.reasoning,'high');
 const d=recovered.decision,ir={schema:'toolkit.gate-contract-ir.v3',run:d.identity.run,lock:d.identity.lock,source_stage:'G2',target_stage:'G3',
  mutation:{allow_paths:d.construction.allow_paths,forbid_extra_paths:true},requirements:d.verification.requirements.map(id=>({id,invariant:'Exact source pin',surfaces:['decision'],
   macros:[{name:'EXACT_ALLOWLIST',params:{field:'action',allow:['READ'],reject_values:['WRITE'],accept:{outcome:'ACCEPT'},reject:{outcome:'REJECT'}}}]})),
  required_validation:[...new Set(d.verification.cases.map(c=>c.runner.id))],required_evidence:['exact-source'],controller_decision:d};
 const packet=compiler.compileGateContract(ir);assert.equal(packet.schema,'toolkit.g3-execution-packet.v3');
 assert.deepEqual(compiler.validateG3ExecutionPacket(packet),packet);assert.equal(packet.controller_decision.selection.registry_digest,recovered.selection.registry_digest);
 const capture=f.decisionEvidence.find(e=>e.reference.id===d.sources.registry.id),snapshot=new selection.StackRegistrySnapshot(capture);
 const binding={source_capture:capture,selection:snapshot.resolve('owner-gpt')};
 const definition=helper.renderNativeHelperDefinition('codex','G1',binding);
 assert.equal(definition.native_configuration.agent_config.model_reasoning_effort,'high');
 assert.equal(definition.registry_revision,recovered.selection.registry_digest);
 assert.deepEqual(definition.route,snapshot.role(binding.selection,'BUILDER_HELPER').route);
 const route=compiler.resolveControllerRole(recovered,'REVIEW','sol').route;
 const q={thread_start:{model:route.model,modelProvider:route.provider,config:{model_reasoning_effort:route.reasoning}},
  turn_start:{model:route.model,effort:route.reasoning},binding:{qualification_digest:'a'.repeat(64)}};
 const prepared=native.buildNativeRequest(recovered,q,'REVIEW','synthetic preparation only',false,null,'sol');
 assert.equal(prepared.binding.route.reasoning,'high');assert.equal(prepared.turn_start.effort,'high');
 assert.equal(prepared.initialize.clientInfo.version,'codex-host-adapter-v2');
 assert.equal(finality.evaluateV3Finality(f.store,f.admission).g2,'REVIEW_SET_ACCEPTED');
 const drift=structuredClone(f.currentProjection);drift.stack_selection.registry_digest=original.selection.registry_digest;
 f.setCurrentObservation(drift,{revision:991,bodyDigest:receipt.digestValue(drift)});
 assert.throws(()=>f.readControllerDecision(),e=>e.code==='GPR_PACKET_CURRENT_UNVERIFIED');
 // No transport, model turn, helper, UAT or native qualification was constructed.
});
