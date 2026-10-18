'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Ajv2020=require('ajv/dist/2020');
const compiler=require('../scripts/toolkit-gate-contract-compiler.cjs'),state=require('../scripts/toolkit-github-program-state-v5.cjs');
const adapter=require('../scripts/toolkit-codex-agent-adapter.cjs'),agent=require('../scripts/toolkit-agent-control.cjs');
// Synthetic data-only core fixture. It cannot create an admission, native proof or successful effect.
const {historicalControllerFixture:coreDecisionFixture,resolveHistorical,originalRegistry}=require('./support/historical-stack-fixture.cjs');


const clone=v=>JSON.parse(JSON.stringify(v));
const packetIR=d=>({schema:'toolkit.gate-contract-ir.v2',run:d.identity.run,lock:d.identity.lock,source_stage:'G2',target_stage:'G3',mutation:{allow_paths:d.construction.allow_paths,forbid_extra_paths:true},requirements:[{id:'K01',invariant:'Same decision boundary',surfaces:['decision'],macros:[{name:'EXACT_ALLOWLIST',params:{field:'action',allow:['READ'],reject_values:['WRITE'],accept:{outcome:'ACCEPT'},reject:{outcome:'REJECT'}}}]}],required_validation:['CORE_DATA_SUITE'],required_evidence:['exact-source'],controller_decision:d});
test('Core source schemas agree with real compiler; data plans never admit execution',()=>{
 const {decision,observations}=coreDecisionFixture();const ajv=new Ajv2020({strict:false,allErrors:true});
 const validate=ajv.compile(compiler.contractSchema('controller-decision-v1.schema.json'));
 assert.equal(validate(decision),true,JSON.stringify(validate.errors));
 const compiled=compiler.compileControllerDecision(decision,observations);
 assert.equal(compiled.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');
 assert.equal(adapter.inspect(decision).status,'DATA_ONLY_NOT_ADMITTED');
 assert.deepEqual(agent.coreDataCommand('core-compile',{decision,observations}),compiled);
 assert.equal(compiled.decision.accounting.debt.unknown_additional,true);
});
test('Closed decision and observation boundaries reject hostile descriptors with zero hooks',()=>{
 const {decision,observations}=coreDecisionFixture();let hooks=0;
 const objects=[Object.assign(clone(decision),{foreign:true}),Object.assign(clone(decision),{schema:'legacy'}),Object.assign(Object.create({foreign:true}),decision)];
 const getter=clone(decision);Object.defineProperty(getter,'selection',{enumerable:true,get(){hooks++;return decision.selection;}});objects.push(getter);
 const proxy=new Proxy(decision,{get(){hooks++;},ownKeys(){hooks++;return []}});objects.push(proxy);
 const symbol=clone(decision);symbol[Symbol('authority')]=true;objects.push(symbol);
 const cycle=clone(decision);cycle.identity.supersedes=cycle;objects.push(cycle);
 const missing=clone(decision);delete missing.sources;objects.push(missing);
 for(const value of objects)assert.throws(()=>compiler.compileControllerDecision(value,observations));assert.equal(hooks,0);
 const evidence=clone(observations);Object.defineProperty(evidence[0],'content_base64',{enumerable:true,get(){hooks++;return observations[0].content_base64;}});
 assert.throws(()=>compiler.compileControllerDecision(decision,evidence));assert.equal(hooks,0);
});
test('Retired mode-0 run and envelope data cannot reach admission through a caller channel',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'core-mode0-nonauth-'));
 let hooks=0;const fake={
  snapshot(){hooks++;return {decision:{identity:{repository:'weijunswj/ai-agent-toolkit',run:'toolkit-core-construction-g3-20261007-001',lock:'DL-TK-CORE-CONSTRUCTION-G3-20261007-001'},decision_digest:'a'.repeat(64)},consumer:{stage:'G3'}};},
  resourceOperation(){hooks++;return {schema:'toolkit.agent-control.resource-envelope.v1'};},
 };
 const worker={host:'claude-code',role:'worker',depth:1,estimated_memory_bytes:agent.GIB,
  child_responsibility:'Implement an isolated bounded resource task.',parent_responsibility:'Retain integration and validation responsibility.',
  integration_plan:'The parent integrates the result.',validation_plan:'The parent checks the result.',material_benefit:'A bounded worker can finish a separable task.',
  tasks_separable:true,concurrent_execution_possible:true,expected_wall_clock_speedup:'The worker can finish sooner.',
  root_retains_longest_or_critical_path:true,child_task_is_shorter_or_easier:true,root_productive_work_declared:true,
  child_prompt:'Implement an isolated bounded resource task.'};
 try{
  for(const options of [
   {root,resourceState:{source:'proc-meminfo',overcommit_mode:0}},
   {root,effectChannel:fake},
   {root,producer_provenance:{schema:'toolkit.agent-control.resource-provenance.v2'}},
  ]){
   assert.equal(Object.hasOwn(agent,'admissionDecisionWithResourceEnvelope'),false);
   const result=agent.admissionDecision(worker,options);
   assert.equal(result.result,agent.RESULTS.REFUSE);
   assert.equal(fs.existsSync(agent.statePath({root})),false);
  }
  assert.equal(fs.existsSync(path.join(root,'jobs')),false);
  assert.equal(hooks,0);
 }finally{fs.rmSync(root,{recursive:true,force:false});}
});
test('All seven builder qualifiers leave the strong lead fixed and preserve the independent Luna helper route',()=>{
 const {decision,source}=coreDecisionFixture(),qualification=clone(decision.selection.builder_qualification);
 for(const key of compiler.CHEAP_QUALIFIERS)qualification[key]={status:'POSITIVE',source};
 const allPositive=resolveHistorical(decision.selection.profile_id,qualification).routes;
 assert.equal(allPositive.BUILDER.model,'gpt-6.1-sol');
 assert.equal(allPositive.BUILDER.reasoning,'high');
 assert.equal(allPositive.BUILDER_HELPER.model,'gpt-6-luna');
 assert.equal(allPositive.BUILDER_HELPER.reasoning,'max');
 for(const key of compiler.CHEAP_QUALIFIERS)for(const status of ['UNKNOWN','NEGATIVE']){
  const changed=clone(qualification);changed[key].status=status;
  assert.deepEqual(resolveHistorical(decision.selection.profile_id,changed).routes,allPositive);
 }
 const missing=clone(qualification);delete missing.bounded_scope;assert.throws(()=>resolveHistorical(decision.selection.profile_id,missing));
});
test('Route versions, required challenge, stable root and finite command aliases are consequential compiler guards',()=>{
 const {decision,observations,source}=coreDecisionFixture();
 for(const id of ['C','D','B','R','owner-openai','G_FRAME'])assert.throws(()=>resolveHistorical(id,decision.selection.builder_qualification));
 for(const mutate of [d=>d.selection.routes.BUILDER.model='gpt-6-luna',d=>d.accounting.stable_root='renamed',d=>d.accounting.debt.kind='EXACT',d=>d.authority.targets=['repo/foreign.md'],d=>d.construction.candidate_ceiling=1,d=>d.assurance.design_challenge_required=true,d=>d.verification.cases[1].boundary='different',d=>d.verification.cases[1].runner.argv.push('--foreign'),d=>d.authority.expires_at='2025-01-01T00:00:00Z']){
  const input=clone(decision);mutate(input);assert.throws(()=>compiler.compileControllerDecision(input,observations));
 }
 const positive=clone(decision);positive.selection.profile_id='owner-mixed-claude-gpt';
 positive.selection.routes=resolveHistorical(positive.selection.profile_id,positive.selection.builder_qualification).routes;
 positive.assurance.design_challenge_required=true;positive.assurance.design_challenge=source;
 assert.equal(compiler.compileControllerDecision(positive,observations).decision.assurance.design_challenge_required,true);
 const unsupported=clone(decision);unsupported.assurance.design_challenge_required=true;unsupported.assurance.design_challenge=source;
 assert.throws(()=>compiler.compileControllerDecision(unsupported,observations));
});
test('Whole raw source custody discriminates omitted, truncated, conflicting and relabelled evidence',()=>{
 const {decision,observations}=coreDecisionFixture();
 for(const evidence of [[],observations.slice(1),[...observations,observations[0]],observations.map((e,i)=>i?e:{...e,content_base64:Buffer.from('truncated').toString('base64')}),observations.map((e,i)=>i?e:{...e,reference:{...e.reference,repository:'foreign/repo'}})])assert.throws(()=>compiler.compileControllerDecision(decision,evidence));
 assert.match(compiler.compileControllerDecision(decision,observations).source_observation_digest,/^[a-f0-9]{64}$/);
});
test('IR v2 consumes the decision while historical v1 remains distinct and closed',()=>{
 const {decision}=coreDecisionFixture();const input=packetIR(decision),output=compiler.compileGateContract(input);
 assert.equal(output.schema,'toolkit.g3-execution-packet.v2');assert.equal(output.controller_decision_digest,compiler.hashCanonical(decision));
 assert.deepEqual(compiler.validateG3ExecutionPacket(output),output);
 const ajv=new Ajv2020({strict:false,allErrors:true});const validate=ajv.compile(compiler.contractSchema('gate-contract-ir-v2.schema.json'));assert.equal(validate(input),true,JSON.stringify(validate.errors));
 const changed=clone(input);changed.required_validation=['OTHER'];assert.throws(()=>compiler.compileGateContract(changed));
 const mixed=clone(input);mixed.requirements[0].id='OTHER';assert.throws(()=>compiler.compileGateContract(mixed));
 const legacy={...input,schema:'toolkit.gate-contract-ir.v1'};delete legacy.controller_decision;assert.equal(compiler.compileGateContract(legacy).schema,'toolkit.g3-execution-packet.v1');
 assert.throws(()=>compiler.compileGateContract({...legacy,controller_decision:decision}));
 const tampered=clone(output);tampered.controller_decision.accounting.stable_root='restart';assert.throws(()=>compiler.validateG3ExecutionPacket(tampered));
});
test('Typed CURRENT metadata never substitutes for an authentic full packet consumer',()=>{
 const ref={schema:'toolkit.controller-decision-reference.v1',version:1,packet_id:'ap1-'+'a'.repeat(64),decision_digest:'b'.repeat(64)};
 const current={predecessors:[{packet_id:ref.packet_id,producer:{stage:'G2'}}]};
 assert.equal(state.validateControllerDecisionReference(ref,current),true);
 assert.equal(state.validateControllerDecisionReference({...ref,version:2},current),false);
 assert.equal(state.validateControllerDecisionReference(ref,{predecessors:[]}),false);
 assert.equal(state.validateControllerDecisionReference({...ref,admitted:true}),false);
 assert.throws(()=>state.consumeControllerDecisionReference(ref,{readControllerDecision(){return ref;}},{}));
 assert.throws(()=>state.controllerDecisionExtension([ref,ref]));
});
test('Canonical owner profiles and visible compatibility aliases resolve to seven explicit V3 routes',()=>{
 const {decision}=coreDecisionFixture();const registry=originalRegistry;assert.equal(Object.keys(registry.profiles).length,3);
 for(const profile of Object.keys(registry.profiles)){
  const value=resolveHistorical(profile,decision.selection.builder_qualification);
  assert.equal(Object.keys(value.routes).length,7);assert.equal(value.registry_version,3);assert.equal(value.profile_id,profile);
 }
 for(const [alias,canonical] of Object.entries(registry.aliases)){
  const resolved=resolveHistorical(alias,decision.selection.builder_qualification);
  assert.equal(resolved.profile_id,canonical);assert.equal(resolved.requested_profile_id,alias);
  assert.deepEqual(resolved.routes,resolveHistorical(canonical,decision.selection.builder_qualification).routes);
 }
 assert.throws(()=>resolveHistorical('owner-openai-continuous-v1',decision.selection.builder_qualification,{...registry,version:2}));
});
test('V3 leads use the approved strong routes while both helpers preserve each stack previous G0 leaf binding',()=>{
 const registry=originalRegistry;
 const history=JSON.parse(fs.readFileSync(path.join(__dirname,'../contracts/controller-kernel/stack-registry-v2.json'),'utf8'));
 for(const id of ['owner-openai-default','owner-claude','owner-mixed-claude-gpt']){
  const routes=registry.profiles[id].routes,oldHelper=history.stacks[id].routes.G0.subagent;
  assert.deepEqual(routes.DISCOVERY,routes.BUILDER);
  assert.deepEqual(routes.DISCOVERY_HELPER,oldHelper);
  assert.deepEqual(routes.BUILDER_HELPER,oldHelper);
  for(const role of ['REVIEW_SCOPE','REVIEW_EXECUTION'])assert.deepEqual(Object.keys(routes[role]).sort(),['model','provider','reasoning']);
 }
 const openai=registry.profiles['owner-openai-default'].routes;
 assert.deepEqual(openai.DISCOVERY,{provider:'openai',model:'gpt-6.1-sol',reasoning:'high'});
 assert.deepEqual(openai.REVIEW_SCOPE,{provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'});
 assert.deepEqual(openai.REVIEW_EXECUTION,{provider:'openai',model:'gpt-6-astra',reasoning:'high'});
 assert.equal(openai.DESIGN_CHALLENGE,null);
 const mixed=registry.profiles['owner-mixed-claude-gpt'].routes;
 assert.deepEqual(mixed.DISCOVERY,{provider:'anthropic',model:'opus-5.5',reasoning:'high'});
 assert.deepEqual(mixed.REVIEW_SCOPE,{provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'});
 assert.deepEqual(mixed.REVIEW_EXECUTION,{provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'});
 assert.deepEqual(mixed.DESIGN_CHALLENGE,{provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'});
});

test('V3 controller defaults to suitable leaves and records substantial direct-work exceptions without tier admission',()=>{
 const {decision}=coreDecisionFixture();
 const task={id:'independent-proof',instruction:'Validate the assigned isolated source boundary.',paths:['repo/fixture.md']};
 for(const stage of ['G0','G1']) {
  const planned=compiler.planV3Delegation({stage,substantial:true,tasks:[task],exception:null},decision);
  assert.equal(planned.action,'DELEGATE_SUITABLE_LEAVES');
  assert.deepEqual(agent.coreDataCommand('core-delegation-plan',{decision,delegation:{stage,substantial:true,tasks:[task],exception:null}}),planned);
  assert.equal(planned.helpers[0].route.model,'gpt-6-luna');
  assert.equal(planned.helpers[0].route.reasoning,'max');
  assert.equal(planned.helpers[0].depth,1);
  assert.equal(planned.helpers[0].may_delegate,false);
  assert.equal(Object.hasOwn(planned.helpers[0],'service_tier'),false);
  assert.throws(()=>compiler.planV3Delegation({stage,substantial:true,tasks:[],exception:null},decision));
  const direct=compiler.planV3Delegation({stage,substantial:true,tasks:[],exception:{kind:'TIGHTLY_COUPLED_REASONING_OR_INTEGRATION',reason:'The lead must resolve the conflicting source identities before independent tasks can proceed.'}},decision);
  assert.equal(direct.action,'DIRECT_WORK');
  assert.equal(direct.authority,'PLAN_ONLY_NATIVE_PERMISSION_REQUIRED');
  assert.throws(()=>compiler.planV3Delegation({stage,substantial:true,tasks:[],exception:{kind:'PERSONAL_PREFERENCE',reason:'Prefer serial work.'}},decision));
 }
 assert.deepEqual(compiler.planV3Delegation({stage:'G2',substantial:true,tasks:[],exception:null},decision).helpers,[]);
 assert.throws(()=>compiler.planV3Delegation({stage:'G2',substantial:true,tasks:[task],exception:null},decision));
 assert.throws(()=>compiler.planV3Delegation({stage:'G1',substantial:true,tasks:[{...task,paths:['outside.md']}],exception:null},decision));
 assert.throws(()=>compiler.planV3Delegation({stage:'G1',substantial:true,tasks:[task],exception:null,service_tier:'UNOBSERVED'},decision));
});
