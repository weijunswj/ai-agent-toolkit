'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),compiler=require('../scripts/toolkit-gate-contract-compiler.cjs'),{StackRegistrySnapshot}=require('../scripts/toolkit-stack-selection.cjs');
function snapshot(registry,revision='controlled-revision'){const bytes=Buffer.from(JSON.stringify(registry));return new StackRegistrySnapshot({reference:{id:'controlled-registry',repository:'controlled/fixture',revision,path:'repo/contracts/controller-kernel/stack-registry-v3.json',content_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),blob_sha1:crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')},content_base64:bytes.toString('base64')});}
const current=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../contracts/controller-kernel/stack-registry-v3.json')));
test('actual restricted validator accepts current closed registry and resolves every complete member set',()=>{const r=current();compiler.checkCoreSchema(r,compiler.contractSchema('stack-registry-v3.schema.json'));const s=snapshot(r);assert.deepEqual([...s.profileIds].sort(),['owner-claude','owner-gpt']);for(const[id,ids]of [['owner-gpt',['sol']],['owner-claude',['opus']]]){const v=s.resolve(id);assert.deepEqual(v.reviewers.map(m=>m.reviewer_id),ids);for(const member of v.reviewers){const {reviewer_id,...route}=member;assert.deepEqual(s.role(v,'REVIEW',reviewer_id).route,route);}for(const role of ['DISCOVERY','DISCOVERY_HELPER','BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE'])assert.deepEqual(s.role(v,role).route,r.profiles[id].routes[role]);}assert.deepEqual(s.role(s.resolve('owner-gpt'),'DESIGN_CHALLENGE').route,{provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'});assert.equal(s.role(s.resolve('owner-claude'),'DESIGN_CHALLENGE').route.reasoning,'xhigh');});
test('missing blank alias foreign role/member and duplicate identity never choose alternatives',()=>{const s=snapshot(current());for(const id of [undefined,'',' ','owner-openai-default','owner-openai-continuous-v1','missing'])assert.throws(()=>s.resolve(id));const v=s.resolve('owner-gpt');for(const [role,id]of [['REVIEW',null],['REVIEW','opus'],['REVIEW_SCOPE',null],['BUILDER','sol']])assert.throws(()=>s.role(v,role,id));const r=current();r.profiles['owner-gpt'].reviewers.push({...r.profiles['owner-gpt'].reviewers[0],reasoning:'max'});assert.throws(()=>snapshot(r),/DUPLICATE/);});
test('captured revision cannot hot-swap and caller route/member forgery cannot pass exact binding',()=>{const r=current(),s=snapshot(r),v=s.resolve('owner-gpt');r.profiles['owner-gpt'].routes.BUILDER.reasoning='max';assert.equal(s.role(v,'BUILDER').route.reasoning,'high');const adopted=snapshot(r,'explicit-new-adoption');assert.equal(adopted.role(adopted.resolve('owner-gpt'),'BUILDER').route.reasoning,'max');assert.throws(()=>adopted.assertSelection(v),/DRIFT/);const changed=JSON.parse(JSON.stringify(v));changed.reviewers[0].model='caller-forged';assert.throws(()=>s.role(changed,'REVIEW','sol'),/DRIFT/);});

const MIXED_IDS=['claude-projects-stack','owner-mixed','owner-mixed-claude-gpt'];
const GATEKEEPER_ROUTE={provider:'anthropic',model:'sonnet-5.5',reasoning:'medium'};
// A registry as it looked while a mixed profile shipped, under either of its names.
function mixedRegistry(id,gatekeeper){
 const registry=current();
 registry.profiles[id]={routes:structuredClone(registry.profiles['owner-gpt'].routes),reviewers:structuredClone(registry.profiles['owner-claude'].reviewers)};
 if(gatekeeper)registry.profiles[id].routes.GATEKEEPER={...GATEKEEPER_ROUTE};
 return registry;
}

test('the bundled registry holds exactly the two owner profiles and no mixed name resolves',()=>{
 const registry=current(),s=snapshot(registry);
 assert.deepEqual(Object.keys(registry.profiles).sort(),['owner-claude','owner-gpt']);
 for(const id of MIXED_IDS)assert.throws(()=>s.resolve(id),{code:'STACK_SELECTION_UNKNOWN'},id);
 for(const id of ['owner-gpt','owner-claude'])assert.deepEqual(Object.keys(s.resolve(id).routes).sort(),['BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE','DISCOVERY','DISCOVERY_HELPER']);
});

test('a captured registry that still carries a mixed profile is refused, under either name and with or without a gatekeeper',()=>{
 for(const [id,gatekeeper] of [['claude-projects-stack',true],['claude-projects-stack',false],['owner-mixed',false],['owner-mixed',true]])
  assert.throws(()=>snapshot(mixedRegistry(id,gatekeeper),'retained-mixed-revision'),{code:'GATE_CONTRACT_IR_INVALID'},`${id}/${gatekeeper}`);
 const withRoute=current();withRoute.profiles['owner-gpt'].routes.GATEKEEPER={...GATEKEEPER_ROUTE};
 assert.throws(()=>snapshot(withRoute),{code:'GATE_CONTRACT_IR_INVALID'},'a gatekeeper route on an owner profile');
 const one=current();delete one.profiles['owner-claude'];
 assert.throws(()=>snapshot(one),{code:'GATE_CONTRACT_IR_INVALID'},'a one-profile registry');
});

test('a two-profile capture resolves unchanged and stays bound to its own revision',()=>{
 const s=snapshot(current(),'retained-old-revision'),before=JSON.stringify(s.resolve('owner-gpt'));
 for(const id of ['owner-gpt','owner-claude'])assert.deepEqual(s.resolve(id).routes,current().profiles[id].routes);
 const next=snapshot(current(),'deliberate-new-revision');
 assert.equal(JSON.stringify(s.resolve('owner-gpt')),before);
 for(const id of ['owner-gpt','owner-claude']) {
  assert.throws(()=>next.assertSelection(s.resolve(id)),{code:'STACK_SELECTION_BINDING_DRIFT'});
  assert.throws(()=>s.assertSelection(next.resolve(id)),{code:'STACK_SELECTION_BINDING_DRIFT'});
 }
});

test('source and selection closure refuses missing names, aliases, foreign members and byte forgery',()=>{
 const s=snapshot(current()),v=s.resolve('owner-gpt');
 for(const [id,code] of [[undefined,'STACK_SELECTION_REQUIRED'],['','STACK_SELECTION_REQUIRED'],[' ','STACK_SELECTION_REQUIRED'],['codex','STACK_SELECTION_UNKNOWN'],['claude-code','STACK_SELECTION_UNKNOWN']])assert.throws(()=>s.resolve(id),{code});
 for(const [id,code] of [[null,'STACK_REVIEWER_REQUIRED'],['','STACK_REVIEWER_REQUIRED'],['opus','STACK_REVIEWER_UNADMITTED']])assert.throws(()=>s.role(v,'REVIEW',id),{code});
 const bytes=Buffer.from(JSON.stringify(current()));
 const capture={reference:s.reference,content_base64:bytes.toString('base64')};
 for(const [name,mutate,code] of [
  ['mutated bytes',c=>c.content_base64=Buffer.concat([bytes,Buffer.from(' ')]).toString('base64'),'STACK_REGISTRY_SOURCE_DRIFT'],
  ['wrong raw digest',c=>c.reference.content_sha256='0'.repeat(64),'STACK_REGISTRY_SOURCE_DRIFT'],
  ['wrong Git blob',c=>c.reference.blob_sha1='0'.repeat(40),'STACK_REGISTRY_BLOB_DRIFT']
 ]){const c=structuredClone(capture);mutate(c);assert.throws(()=>new StackRegistrySnapshot(c),{code},name);}
 for(const [name,mutate] of [
  ['host-derived profile',x=>x.profile_id='owner-claude'],['foreign reviewer',x=>x.reviewers[0].reviewer_id='opus'],
  ['omitted reviewer',x=>x.reviewers=[]],['extra reviewer',x=>x.reviewers.push({...x.reviewers[0],reviewer_id:'opus'})],
  ['duplicate reviewer',x=>x.reviewers.push({...x.reviewers[0]})],['route override',x=>x.routes.BUILDER.reasoning='max'],
  ['unadopted revision',x=>x.registry_reference.revision='newest-bundle']
 ]){const x=structuredClone(v);mutate(x);assert.throws(()=>s.assertSelection(x),{code:'STACK_SELECTION_BINDING_DRIFT'},name);}
});

test('gatekeeper is no registry role: no profile admits it and a forged route cannot add it',()=>{
 const s=snapshot(current());
 for(const id of ['owner-gpt','owner-claude']){
  const v=s.resolve(id);
  for(const [role,member,code] of [
   ['GATEKEEPER',null,'STACK_ROLE_UNADMITTED'],['G0',null,'STACK_ROLE_UNADMITTED'],['G1',null,'STACK_ROLE_UNADMITTED'],['G2',null,'STACK_ROLE_UNADMITTED'],
   ['GATEKEEPER',v.reviewers[0].reviewer_id,'STACK_ROLE_UNADMITTED'],['REVIEW','gatekeeper','STACK_REVIEWER_UNADMITTED'],['REVIEW','GATEKEEPER','STACK_REVIEWER_UNADMITTED']
  ])assert.throws(()=>s.role(v,role,member),{code},`${id}/${role}/${member}`);
  const forged=structuredClone(v);forged.routes.GATEKEEPER={...GATEKEEPER_ROUTE};
  assert.throws(()=>s.role(forged,'GATEKEEPER'),{code:'STACK_SELECTION_BINDING_DRIFT'},id);
 }
});
