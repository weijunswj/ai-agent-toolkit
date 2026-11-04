'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),compiler=require('../scripts/toolkit-gate-contract-compiler.cjs'),{currentControllerFixture}=require('./support/current-controller-fixture.cjs'),clone=x=>JSON.parse(JSON.stringify(x));
test('actual compiler verifies captured current registry and full reviewer sets for every stack',()=>{for(const[id,count]of [['owner-gpt',1],['owner-claude',1],['owner-mixed',1]]){const f=currentControllerFixture(id);compiler.checkCoreSchema(f.decision,compiler.contractSchema('controller-decision-v2.schema.json'));const c=compiler.compileControllerDecision(f.decision,f.observations);assert.equal(c.selection.profile_id,id);assert.equal(c.selection.reviewers.length,count);assert.deepEqual(c.selection.registry_reference,f.decision.sources.registry);for(const m of c.selection.reviewers){const {reviewer_id,...route}=m;assert.deepEqual(compiler.resolveControllerRole(c,'REVIEW',reviewer_id).route,route);}assert.equal(c.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');}});
test('forged member, route, registry digest, revision or missing source fails compilation',()=>{for(const kind of ['member-model','missing-member','extra-member','duplicate-member','builder','digest','revision','missing-source']){const f=currentControllerFixture(),d=clone(f.decision),e=clone(f.observations);if(kind==='member-model')d.selection.reviewers[0].model='forged';if(kind==='missing-member')d.selection.reviewers.pop();if(kind==='extra-member')d.selection.reviewers.push({reviewer_id:'opus',provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'});if(kind==='duplicate-member')d.selection.reviewers.push({...d.selection.reviewers[0]});if(kind==='builder')d.selection.routes.BUILDER.reasoning='max';if(kind==='digest')d.selection.registry_digest='a'.repeat(64);if(kind==='revision')d.sources.registry.revision='unobserved';if(kind==='missing-source')e.pop();assert.throws(()=>compiler.compileControllerDecision(d,e),kind);}});
test('explicit changed captured route reaches compiler and role consumers without changing active snapshots',()=>{const original=currentControllerFixture(),active=compiler.compileControllerDecision(original.decision,original.observations),registry=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../contracts/controller-kernel/stack-registry-v3.json')));registry.profiles['owner-gpt'].reviewers[0].reasoning='high';const adopted=currentControllerFixture('owner-gpt',registry),next=compiler.compileControllerDecision(adopted.decision,adopted.observations);assert.equal(compiler.resolveControllerRole(active,'REVIEW','sol').route.reasoning,'xhigh');assert.equal(compiler.resolveControllerRole(next,'REVIEW','sol').route.reasoning,'high');assert.notEqual(next.selection.registry_digest,active.selection.registry_digest);assert.throws(()=>compiler.resolveControllerRole(next,'REVIEW','opus'));assert.throws(()=>compiler.resolveControllerRole(next,'REVIEW_SCOPE'));});

test('mixed compiles with exact GPT lead and Opus review, and source or roster forgery cannot compile',()=>{
 const f=currentControllerFixture('owner-mixed');
 const ajv=new (require('ajv/dist/2020'))({strict:false,allErrors:true});
 assert.equal(ajv.compile(compiler.contractSchema('controller-decision-v2.schema.json'))(f.decision),true);
 const c=compiler.compileControllerDecision(f.decision,f.observations);
 assert.deepEqual(compiler.resolveControllerRole(c,'BUILDER').route,{provider:'openai',model:'gpt-6.1-sol',reasoning:'high'});
 assert.deepEqual(compiler.resolveControllerRole(c,'REVIEW','opus').route,{provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'});
 assert.equal(c.authority_status,'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION');
 for(const [name,mutate] of [
  ['foreign member',d=>d.selection.reviewers[0].reviewer_id='sol'],
  ['forged reviewer',d=>d.selection.reviewers[0].model='gpt-6.1-sol'],
  ['omitted reviewer',d=>d.selection.reviewers=[]],
  ['additional reviewer',d=>d.selection.reviewers.push({reviewer_id:'sol',provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'})],
  ['duplicate reviewer',d=>d.selection.reviewers.push({...d.selection.reviewers[0]})],
  ['forged lead',d=>d.selection.routes.BUILDER.model='opus-5.5'],
  ['wrong digest',d=>d.selection.registry_digest='0'.repeat(64)],
  ['wrong revision',d=>d.sources.registry.revision='unobserved-newest'],
  ['host-derived selection',d=>d.selection.profile_id='owner-gpt']
 ]){const d=clone(f.decision);mutate(d);assert.throws(()=>compiler.compileControllerDecision(d,f.observations),name);}
 assert.throws(()=>compiler.compileControllerDecision(f.decision,f.observations.slice(1)));
});

test('explicit adoption of a three-profile capture retains both old active decisions and rejects cross-binding',()=>{
 const registry=compiler.contractSchema('stack-registry-v3.json'),old=clone(registry);delete old.profiles['owner-mixed'];
 for(const id of ['owner-gpt','owner-claude']){
  const f=currentControllerFixture(id,old),active=compiler.compileControllerDecision(f.decision,f.observations);
  const before=JSON.stringify(active),next=currentControllerFixture(id,registry);
  const adopted=compiler.compileControllerDecision(next.decision,next.observations);
  assert.deepEqual(active.selection.routes,adopted.selection.routes);assert.deepEqual(active.selection.reviewers,adopted.selection.reviewers);
  assert.notEqual(active.selection.registry_digest,adopted.selection.registry_digest);
  assert.equal(JSON.stringify(active),before);
  for(const [d,e] of [[f.decision,next.observations],[next.decision,f.observations]])assert.throws(()=>compiler.compileControllerDecision(d,e));
 }
 assert.throws(()=>currentControllerFixture('owner-mixed',old),{code:'STACK_SELECTION_UNKNOWN'});
 assert.equal(compiler.compileControllerDecision(currentControllerFixture('owner-mixed').decision,currentControllerFixture('owner-mixed').observations).selection.profile_id,'owner-mixed');
});
