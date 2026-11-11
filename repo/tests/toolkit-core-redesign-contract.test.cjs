'use strict';
// Controller-decision v2 compilation and delegation planning against the current registry. Synthetic
// source data only: nothing here admits, launches or qualifies a native host.
const test=require('node:test'),assert=require('node:assert/strict');
const Ajv2020=require('ajv/dist/2020');
const compiler=require('../scripts/toolkit-gate-contract-compiler.cjs');
const {currentControllerFixture}=require('./support/current-controller-fixture.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));

test('Ajv and the restricted evaluator agree on the one closed registry shape: exactly the two owner profiles',()=>{
 const schema=compiler.contractSchema('stack-registry-v3.schema.json');
 const validate=new Ajv2020({strict:false,allErrors:true}).compile(schema);
 const current=compiler.contractSchema('stack-registry-v3.json');
 const gatekeeper={provider:'anthropic',model:'sonnet-5.5',reasoning:'medium'};
 const mixed=(id,withGatekeeper)=>r=>{r.profiles[id]={routes:clone(r.profiles['owner-gpt'].routes),reviewers:clone(r.profiles['owner-claude'].reviewers)};if(withGatekeeper)r.profiles[id].routes.GATEKEEPER=clone(gatekeeper);};
 const cases=[['current two profiles',current,true]];
 for(const [name,mutate] of [
  ['unknown profile',r=>r.profiles.unknown=clone(r.profiles['owner-gpt'])],
  ['missing GPT',r=>delete r.profiles['owner-gpt']],['missing Claude',r=>delete r.profiles['owner-claude']],
  ['empty profiles',r=>r.profiles={}],['null profile',r=>r.profiles['owner-gpt']=null],
  // Both names the removed mixed profile shipped under, in each shape it had.
  ['removed mixed profile with a gatekeeper',mixed('claude-projects-stack',true)],
  ['removed mixed profile without a gatekeeper',mixed('claude-projects-stack',false)],
  ['older mixed name',mixed('owner-mixed',false)],
  ['older mixed name with a gatekeeper',mixed('owner-mixed',true)],
  ['earliest mixed name',mixed('owner-mixed-claude-gpt',false)],
  ['missing routes',r=>delete r.profiles['owner-gpt'].routes],
  ['missing role',r=>delete r.profiles['owner-gpt'].routes.BUILDER],
  ['unknown role',r=>r.profiles['owner-gpt'].routes.REVIEW=clone(r.profiles['owner-gpt'].routes.BUILDER)],
  ['foreign field',r=>r.profiles['owner-gpt'].automatic=true],
  ['effort instead of reasoning',r=>{const x=r.profiles['owner-gpt'].routes.BUILDER;x.effort=x.reasoning;delete x.reasoning;}],
  ['effort beside reasoning',r=>r.profiles['owner-gpt'].routes.BUILDER.effort='high'],
  ['unsupported provider',r=>r.profiles['owner-gpt'].routes.BUILDER.provider='foreign'],
  ['blank model',r=>r.profiles['owner-gpt'].routes.BUILDER.model=' '],
  ['wrong reasoning',r=>r.profiles['owner-gpt'].routes.BUILDER.reasoning='low'],
  ['empty reviewers',r=>r.profiles['owner-gpt'].reviewers=[]],
  ['unknown reviewer',r=>r.profiles['owner-gpt'].reviewers[0].reviewer_id='foreign'],
  ['reviewer extra field',r=>r.profiles['owner-gpt'].reviewers[0].fallback=true],
  ['gatekeeper route on an owner profile',r=>r.profiles['owner-claude'].routes.GATEKEEPER=clone(gatekeeper)],
  ['gatekeeper reviewer',r=>r.profiles['owner-claude'].reviewers=[{reviewer_id:'gatekeeper',...gatekeeper}]],
  ['gatekeeper as a gate role',r=>r.profiles['owner-claude'].routes.G0=clone(gatekeeper)]
 ]){const value=clone(current);mutate(value);cases.push([name,value,false]);}
 for(const [name,value,expected] of cases){
  assert.equal(validate(value),expected,`${name}: ${JSON.stringify(validate.errors)}`);
  if(expected)assert.equal(compiler.checkCoreSchema(value,schema),true,name);
  else assert.throws(()=>compiler.checkCoreSchema(value,schema),name);
 }
});

test('the v2 decision schema agrees with the compiler; a compiled decision is a plan only',()=>{
 const {decision,observations}=currentControllerFixture();const ajv=new Ajv2020({strict:false,allErrors:true});
 const validate=ajv.compile(compiler.contractSchema('controller-decision-v2.schema.json'));
 assert.equal(validate(decision),true,JSON.stringify(validate.errors));
 const compiled=compiler.compileControllerDecision(decision,observations);
 assert.equal(compiled.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');
 assert.equal(compiled.decision.accounting.debt.unknown_additional,true);
 const v1=clone(decision);v1.schema='toolkit.controller-decision.v1';
 assert.throws(()=>compiler.compileControllerDecision(v1,observations),'a superseded decision version is rejected');
});

test('both decision profile enums accept the two owner selections and reject removed or inferred names',()=>{
 const decisionSchema=compiler.contractSchema('controller-decision-v2.schema.json');
 const ir=compiler.contractSchema('gate-contract-ir-v3.schema.json');
 // The retained nested IR decision is a structural contract, not an executable gate launcher.
 for(const [name,schema,root] of [['decision',decisionSchema,decisionSchema],['nested IR',ir.properties.controller_decision,ir.properties.controller_decision]]){
  const validate=new Ajv2020({strict:false,allErrors:true}).compile({...schema,$defs:root.$defs});
  for(const id of ['owner-gpt','owner-claude']){
   const {decision}=currentControllerFixture(id);
   assert.equal(validate(decision),true,`${name}/${id}: ${JSON.stringify(validate.errors)}`);
   assert.equal(compiler.checkCoreSchema(decision,schema,root),true);
  }
  for(const id of ['claude-projects-stack','owner-mixed','owner-mixed-claude-gpt','codex','claude-code','', 'unknown']){
   const {decision}=currentControllerFixture('owner-gpt');decision.selection.profile_id=id;
   assert.equal(validate(decision),false,`${name}/${id}`);
   assert.throws(()=>compiler.checkCoreSchema(decision,schema,root));
  }
 }
});

test('closed decision and observation boundaries reject hostile descriptors with zero hooks',()=>{
 const {decision,observations}=currentControllerFixture();let hooks=0;
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

test('routes, required challenge, stable root and finite command aliases are consequential compiler guards',()=>{
 const {decision,observations,source}=currentControllerFixture();
 for(const mutate of [d=>d.selection.routes.BUILDER.model='gpt-6-luna',d=>d.selection.profile_id='owner-mixed-claude-gpt',d=>d.accounting.stable_root='renamed',d=>d.accounting.debt.kind='EXACT',d=>d.authority.targets=['repo/foreign.md'],d=>d.construction.candidate_ceiling=1,d=>d.verification.cases[1].boundary='different',d=>d.verification.cases[1].runner.argv.push('--foreign'),d=>d.authority.expires_at='2025-01-01T00:00:00Z']){
  const input=clone(decision);mutate(input);assert.throws(()=>compiler.compileControllerDecision(input,observations));
 }
 const challenged=clone(decision);challenged.assurance.design_challenge_required=true;challenged.assurance.design_challenge=source;
 assert.equal(compiler.compileControllerDecision(challenged,observations).decision.assurance.design_challenge_required,true);
 const unnamed=clone(decision);unnamed.assurance.design_challenge_required=true;
 assert.throws(()=>compiler.compileControllerDecision(unnamed,observations));
});

test('whole raw source custody discriminates omitted, truncated, conflicting and relabelled evidence',()=>{
 const {decision,observations}=currentControllerFixture();
 for(const evidence of [[],observations.slice(1),[...observations,observations[0]],observations.map((e,i)=>i?e:{...e,content_base64:Buffer.from('truncated').toString('base64')}),observations.map((e,i)=>i?e:{...e,reference:{...e.reference,repository:'foreign/repo'}})])assert.throws(()=>compiler.compileControllerDecision(decision,evidence));
 assert.match(compiler.compileControllerDecision(decision,observations).source_observation_digest,/^[a-f0-9]{64}$/);
});

test('V3 delegation plans default to suitable leaves and record substantial direct-work exceptions without tier admission',()=>{
 const {decision}=currentControllerFixture('owner-gpt');
 const task={id:'independent-proof',instruction:'Validate the assigned isolated source boundary.',paths:['repo/fixture.md']};
 for(const stage of ['G0','G1']) {
  const planned=compiler.planV3Delegation({stage,substantial:true,tasks:[task],exception:null},decision);
  assert.equal(planned.action,'DELEGATE_SUITABLE_LEAVES');
  assert.deepEqual(planned.helpers[0].route,decision.selection.routes[stage==='G0'?'DISCOVERY_HELPER':'BUILDER_HELPER']);
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
