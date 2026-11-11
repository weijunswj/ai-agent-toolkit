'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),compiler=require('../scripts/toolkit-gate-contract-compiler.cjs'),{currentControllerFixture}=require('./support/current-controller-fixture.cjs'),clone=x=>JSON.parse(JSON.stringify(x));
test('actual compiler verifies captured current registry and full reviewer sets for every stack',()=>{for(const[id,count]of [['owner-gpt',1],['owner-claude',1]]){const f=currentControllerFixture(id);compiler.checkCoreSchema(f.decision,compiler.contractSchema('controller-decision-v2.schema.json'));const c=compiler.compileControllerDecision(f.decision,f.observations);assert.equal(c.selection.profile_id,id);assert.equal(c.selection.reviewers.length,count);assert.deepEqual(c.selection.registry_reference,f.decision.sources.registry);for(const m of c.selection.reviewers){const {reviewer_id,...route}=m;assert.deepEqual(compiler.resolveControllerRole(c,'REVIEW',reviewer_id).route,route);}assert.equal(c.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');}});
test('forged member, route, registry digest, revision or missing source fails compilation',()=>{for(const kind of ['member-model','missing-member','extra-member','duplicate-member','builder','digest','revision','missing-source']){const f=currentControllerFixture(),d=clone(f.decision),e=clone(f.observations);if(kind==='member-model')d.selection.reviewers[0].model='forged';if(kind==='missing-member')d.selection.reviewers.pop();if(kind==='extra-member')d.selection.reviewers.push({reviewer_id:'opus',provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'});if(kind==='duplicate-member')d.selection.reviewers.push({...d.selection.reviewers[0]});if(kind==='builder')d.selection.routes.BUILDER.reasoning='max';if(kind==='digest')d.selection.registry_digest='a'.repeat(64);if(kind==='revision')d.sources.registry.revision='unobserved';if(kind==='missing-source')e.pop();assert.throws(()=>compiler.compileControllerDecision(d,e),kind);}});
test('explicit changed captured route reaches compiler and role consumers without changing active snapshots',()=>{const original=currentControllerFixture(),active=compiler.compileControllerDecision(original.decision,original.observations),registry=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../contracts/controller-kernel/stack-registry-v3.json')));registry.profiles['owner-gpt'].reviewers[0].reasoning='high';const adopted=currentControllerFixture('owner-gpt',registry),next=compiler.compileControllerDecision(adopted.decision,adopted.observations);assert.equal(compiler.resolveControllerRole(active,'REVIEW','sol').route.reasoning,'xhigh');assert.equal(compiler.resolveControllerRole(next,'REVIEW','sol').route.reasoning,'high');assert.notEqual(next.selection.registry_digest,active.selection.registry_digest);assert.throws(()=>compiler.resolveControllerRole(next,'REVIEW','opus'));assert.throws(()=>compiler.resolveControllerRole(next,'REVIEW_SCOPE'));});

const GATEKEEPER_ROUTE={provider:'anthropic',model:'sonnet-5.5',reasoning:'medium'};
const SCHEMAS=()=>[compiler.contractSchema('controller-decision-v2.schema.json'),compiler.contractSchema('gate-contract-ir-v3.schema.json').properties.controller_decision];

test('each owner stack compiles with its exact lead and reviewer, and source or roster forgery cannot compile',()=>{
 for(const [id,lead,member,other] of [['owner-gpt',{provider:'openai',model:'gpt-6.1-sol',reasoning:'high'},'sol','opus'],['owner-claude',{provider:'anthropic',model:'opus-5.5',reasoning:'high'},'opus','sol']]){
  const f=currentControllerFixture(id);
  const ajv=new (require('ajv/dist/2020'))({strict:false,allErrors:true});
  assert.equal(ajv.compile(compiler.contractSchema('controller-decision-v2.schema.json'))(f.decision),true);
  const c=compiler.compileControllerDecision(f.decision,f.observations);
  assert.deepEqual(compiler.resolveControllerRole(c,'BUILDER').route,lead);
  assert.equal(compiler.resolveControllerRole(c,'REVIEW',member).route.reasoning,'xhigh');
  assert.throws(()=>compiler.resolveControllerRole(c,'GATEKEEPER'),id);
  assert.equal(c.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');
  for(const [name,mutate] of [
   ['foreign member',d=>d.selection.reviewers[0].reviewer_id=other],
   ['forged reviewer',d=>d.selection.reviewers[0].model='forged'],
   ['omitted reviewer',d=>d.selection.reviewers=[]],
   ['additional reviewer',d=>d.selection.reviewers.push({...d.selection.reviewers[0],reviewer_id:other})],
   ['duplicate reviewer',d=>d.selection.reviewers.push({...d.selection.reviewers[0]})],
   ['forged lead',d=>d.selection.routes.BUILDER.model='forged'],
   ['wrong digest',d=>d.selection.registry_digest='0'.repeat(64)],
   ['wrong revision',d=>d.sources.registry.revision='unobserved-newest'],
   ['host-derived selection',d=>d.selection.profile_id=id==='owner-gpt'?'owner-claude':'owner-gpt'],
   ['added gatekeeper route',d=>d.selection.routes.GATEKEEPER={...GATEKEEPER_ROUTE}],
   ['mixed profile name',d=>d.selection.profile_id='claude-projects-stack'],
   ['older mixed profile name',d=>d.selection.profile_id='owner-mixed']
  ]){const d=clone(f.decision);mutate(d);assert.throws(()=>compiler.compileControllerDecision(d,f.observations),`${id}: ${name}`);}
  assert.throws(()=>compiler.compileControllerDecision(f.decision,f.observations.slice(1)));
 }
});

test('a decision or nested IR that names a mixed profile or carries a gatekeeper route is refused by both schemas',()=>{
 const f=currentControllerFixture('owner-gpt');
 for(const schema of SCHEMAS()){
  const validate=new (require('ajv/dist/2020'))({strict:false,allErrors:true}).compile(schema);
  assert.equal(validate(f.decision),true,JSON.stringify(validate.errors));
  assert.equal(compiler.checkCoreSchema(f.decision,schema),true);
  for(const [name,mutate] of [
   ['claude-projects-stack',d=>d.selection.profile_id='claude-projects-stack'],
   ['owner-mixed',d=>d.selection.profile_id='owner-mixed'],
   ['gatekeeper route',d=>d.selection.routes.GATEKEEPER={...GATEKEEPER_ROUTE}]
  ]){
   const d=clone(f.decision);mutate(d);
   assert.equal(validate(d),false,name);
   assert.throws(()=>compiler.checkCoreSchema(d,schema),{code:'GATE_CONTRACT_IR_INVALID'},name);
  }
 }
});

test('a captured registry that still carries a mixed profile cannot back a decision, under either name',()=>{
 for(const [id,gatekeeper] of [['claude-projects-stack',true],['owner-mixed',false]]){
  const registry=compiler.contractSchema('stack-registry-v3.json');
  registry.profiles[id]={routes:clone(registry.profiles['owner-gpt'].routes),reviewers:clone(registry.profiles['owner-claude'].reviewers)};
  if(gatekeeper)registry.profiles[id].routes.GATEKEEPER={...GATEKEEPER_ROUTE};
  for(const selected of [id,'owner-gpt'])assert.throws(()=>currentControllerFixture(selected,registry),{code:'GATE_CONTRACT_IR_INVALID'},`${id}/${selected}`);
 }
 for(const id of ['claude-projects-stack','owner-mixed'])assert.throws(()=>currentControllerFixture(id),{code:'STACK_SELECTION_UNKNOWN'},id);
});

test('two captures of the same routes stay bound to their own revision and reject cross-binding',()=>{
 const registry=compiler.contractSchema('stack-registry-v3.json'),reordered={schema:registry.schema,version:registry.version,profiles:{'owner-claude':registry.profiles['owner-claude'],'owner-gpt':registry.profiles['owner-gpt']}};
 for(const id of ['owner-gpt','owner-claude']){
  const f=currentControllerFixture(id,reordered),active=compiler.compileControllerDecision(f.decision,f.observations);
  const before=JSON.stringify(active),next=currentControllerFixture(id);
  const adopted=compiler.compileControllerDecision(next.decision,next.observations);
  assert.deepEqual(active.selection.routes,adopted.selection.routes);assert.deepEqual(active.selection.reviewers,adopted.selection.reviewers);
  assert.notEqual(active.selection.registry_digest,adopted.selection.registry_digest);
  assert.equal(JSON.stringify(active),before);
  for(const [d,e] of [[f.decision,next.observations],[next.decision,f.observations]])assert.throws(()=>compiler.compileControllerDecision(d,e));
 }
});
