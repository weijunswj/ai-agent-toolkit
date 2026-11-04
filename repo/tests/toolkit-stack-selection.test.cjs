'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),compiler=require('../scripts/toolkit-gate-contract-compiler.cjs'),{StackRegistrySnapshot}=require('../scripts/toolkit-stack-selection.cjs');
function snapshot(registry,revision='controlled-revision'){const bytes=Buffer.from(JSON.stringify(registry));return new StackRegistrySnapshot({reference:{id:'controlled-registry',repository:'controlled/fixture',revision,path:'repo/contracts/controller-kernel/stack-registry-v3.json',content_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),blob_sha1:crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')},content_base64:bytes.toString('base64')});}
const current=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../contracts/controller-kernel/stack-registry-v3.json')));
test('actual restricted validator accepts current closed registry and resolves every complete member set',()=>{const r=current();compiler.checkCoreSchema(r,compiler.contractSchema('stack-registry-v3.schema.json'));const s=snapshot(r);assert.deepEqual([...s.profileIds].sort(),['claude-projects-stack','owner-claude','owner-gpt']);for(const[id,ids]of [['owner-gpt',['sol']],['owner-claude',['opus']],['claude-projects-stack',['opus']]]){const v=s.resolve(id);assert.deepEqual(v.reviewers.map(m=>m.reviewer_id),ids);for(const member of v.reviewers){const {reviewer_id,...route}=member;assert.deepEqual(s.role(v,'REVIEW',reviewer_id).route,route);}for(const role of ['DISCOVERY','DISCOVERY_HELPER','BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE'])assert.deepEqual(s.role(v,role).route,r.profiles[id].routes[role]);}assert.deepEqual(s.role(s.resolve('owner-gpt'),'DESIGN_CHALLENGE').route,{provider:'openai',model:'gpt-6.1-sol',reasoning:'xhigh'});assert.equal(s.role(s.resolve('owner-claude'),'DESIGN_CHALLENGE').route.reasoning,'xhigh');});
test('missing blank alias foreign role/member and duplicate identity never choose alternatives',()=>{const s=snapshot(current());for(const id of [undefined,'',' ','owner-openai-default','owner-openai-continuous-v1','missing'])assert.throws(()=>s.resolve(id));const v=s.resolve('owner-gpt');for(const [role,id]of [['REVIEW',null],['REVIEW','opus'],['REVIEW_SCOPE',null],['BUILDER','sol']])assert.throws(()=>s.role(v,role,id));const r=current();r.profiles['owner-gpt'].reviewers.push({...r.profiles['owner-gpt'].reviewers[0],reasoning:'max'});assert.throws(()=>snapshot(r),/DUPLICATE/);});
test('captured revision cannot hot-swap and caller route/member forgery cannot pass exact binding',()=>{const r=current(),s=snapshot(r),v=s.resolve('owner-gpt');r.profiles['owner-gpt'].routes.BUILDER.reasoning='max';assert.equal(s.role(v,'BUILDER').route.reasoning,'high');const adopted=snapshot(r,'explicit-new-adoption');assert.equal(adopted.role(adopted.resolve('owner-gpt'),'BUILDER').route.reasoning,'max');assert.throws(()=>adopted.assertSelection(v),/DRIFT/);const changed=JSON.parse(JSON.stringify(v));changed.reviewers[0].model='caller-forged';assert.throws(()=>s.role(changed,'REVIEW','sol'),/DRIFT/);});

test('mixed routes have the exact GPT leads and helpers and the sole Opus reviewer',()=>{
 const s=snapshot(current()),v=s.resolve('claude-projects-stack');
 for(const [role,model,reasoning] of [
  ['DISCOVERY','gpt-6.1-sol','high'],['BUILDER','gpt-6.1-sol','high'],
  ['DISCOVERY_HELPER','gpt-6-luna','max'],['BUILDER_HELPER','gpt-6-luna','max'],
  ['DESIGN_CHALLENGE','gpt-6.1-sol','xhigh']
 ]) assert.deepEqual(s.role(v,role).route,{provider:'openai',model,reasoning});
 const {GATEKEEPER,...gateRoutes}=v.routes;
 assert.deepEqual(GATEKEEPER,{provider:'anthropic',model:'sonnet-5.5',reasoning:'medium'});
 assert.deepEqual(gateRoutes,current().profiles['owner-gpt'].routes);
 assert.deepEqual(v.reviewers,[{reviewer_id:'opus',provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'}]);
});

test('old two-profile captures resolve unchanged and never acquire mixed from the bundle',()=>{
 const old=current();delete old.profiles['claude-projects-stack'];const s=snapshot(old,'retained-old-revision');
 const before=JSON.stringify(s.resolve('owner-gpt'));
 for(const id of ['owner-gpt','owner-claude'])assert.deepEqual(s.resolve(id).routes,old.profiles[id].routes);
 assert.throws(()=>s.resolve('claude-projects-stack'),{code:'STACK_SELECTION_UNKNOWN'});
 const next=snapshot(current(),'deliberate-new-revision');
 assert.equal(next.resolve('claude-projects-stack').profile_id,'claude-projects-stack');
 assert.equal(JSON.stringify(s.resolve('owner-gpt')),before);
 for(const id of ['owner-gpt','owner-claude']) {
  assert.throws(()=>next.assertSelection(s.resolve(id)),{code:'STACK_SELECTION_BINDING_DRIFT'});
  assert.throws(()=>s.assertSelection(next.resolve(id)),{code:'STACK_SELECTION_BINDING_DRIFT'});
 }
});

test('mixed source and selection closure refuses missing names, aliases, foreign members and byte forgery',()=>{
 const s=snapshot(current()),v=s.resolve('claude-projects-stack');
 for(const [id,code] of [[undefined,'STACK_SELECTION_REQUIRED'],['','STACK_SELECTION_REQUIRED'],[' ','STACK_SELECTION_REQUIRED'],['codex','STACK_SELECTION_UNKNOWN'],['claude-code','STACK_SELECTION_UNKNOWN'],['owner-mixed-claude-gpt','STACK_SELECTION_UNKNOWN']])assert.throws(()=>s.resolve(id),{code});
 for(const [id,code] of [[null,'STACK_REVIEWER_REQUIRED'],['','STACK_REVIEWER_REQUIRED'],['sol','STACK_REVIEWER_UNADMITTED']])assert.throws(()=>s.role(v,'REVIEW',id),{code});
 const bytes=Buffer.from(JSON.stringify(current()));
 const capture={reference:s.reference,content_base64:bytes.toString('base64')};
 for(const [name,mutate,code] of [
  ['mutated bytes',c=>c.content_base64=Buffer.concat([bytes,Buffer.from(' ')]).toString('base64'),'STACK_REGISTRY_SOURCE_DRIFT'],
  ['wrong raw digest',c=>c.reference.content_sha256='0'.repeat(64),'STACK_REGISTRY_SOURCE_DRIFT'],
  ['wrong Git blob',c=>c.reference.blob_sha1='0'.repeat(40),'STACK_REGISTRY_BLOB_DRIFT']
 ]){const c=structuredClone(capture);mutate(c);assert.throws(()=>new StackRegistrySnapshot(c),{code},name);}
 for(const [name,mutate] of [
  ['host-derived profile',x=>x.profile_id='owner-gpt'],['foreign reviewer',x=>x.reviewers[0].reviewer_id='sol'],
  ['omitted reviewer',x=>x.reviewers=[]],['extra reviewer',x=>x.reviewers.push({...x.reviewers[0],reviewer_id:'sol'})],
  ['duplicate reviewer',x=>x.reviewers.push({...x.reviewers[0]})],['route override',x=>x.routes.BUILDER.reasoning='max'],
  ['unadopted revision',x=>x.registry_reference.revision='newest-bundle']
 ]){const x=structuredClone(v);mutate(x);assert.throws(()=>s.assertSelection(x),{code:'STACK_SELECTION_BINDING_DRIFT'},name);}
});

test('gatekeeper is an exact relay route, never a substitute gate or reviewer',()=>{
 const s=snapshot(current()),v=s.resolve('claude-projects-stack');
 assert.deepEqual(s.role(v,'GATEKEEPER').route,{provider:'anthropic',model:'sonnet-5.5',reasoning:'medium'});
 for(const id of ['owner-gpt','owner-claude'])assert.throws(()=>s.role(s.resolve(id),'GATEKEEPER'),{code:'STACK_ROLE_UNADMITTED'});
 for(const [role,member,code] of [
  ['G0',null,'STACK_ROLE_UNADMITTED'],['G1',null,'STACK_ROLE_UNADMITTED'],['G2',null,'STACK_ROLE_UNADMITTED'],
  ['GATEKEEPER','opus','STACK_ROLE_UNADMITTED'],['REVIEW','gatekeeper','STACK_REVIEWER_UNADMITTED'],
  ['REVIEW','GATEKEEPER','STACK_REVIEWER_UNADMITTED']
 ])assert.throws(()=>s.role(v,role,member),{code},`${role}/${member}`);
 for(const role of ['DISCOVERY','BUILDER','DESIGN_CHALLENGE']){
  const forged=structuredClone(v);forged.routes[role]=forged.routes.GATEKEEPER;
  assert.throws(()=>s.role(forged,role),{code:'STACK_SELECTION_BINDING_DRIFT'},role);
 }
 assert.throws(()=>s.resolve('owner-mixed'),{code:'STACK_SELECTION_UNKNOWN'});
});

test('retained mixed capture stays bound to its old routes until deliberate Projects adoption',()=>{
 const registry=current();registry.profiles['owner-mixed']=registry.profiles['claude-projects-stack'];
 delete registry.profiles['claude-projects-stack'];delete registry.profiles['owner-mixed'].routes.GATEKEEPER;
 const old=snapshot(registry,'retained-mixed-revision'),selection=old.resolve('owner-mixed');
 const next=snapshot(current(),'deliberate-Projects-adoption');
 for(const role of ['DISCOVERY','DISCOVERY_HELPER','BUILDER','BUILDER_HELPER','DESIGN_CHALLENGE'])
  assert.deepEqual(old.role(selection,role).route,registry.profiles['owner-mixed'].routes[role]);
 assert.deepEqual(old.role(selection,'REVIEW','opus').route,{provider:'anthropic',model:'opus-5.5',reasoning:'xhigh'});
 assert.throws(()=>old.role(selection,'GATEKEEPER'),{code:'STACK_ROLE_UNADMITTED'});
 assert.throws(()=>old.resolve('claude-projects-stack'),{code:'STACK_SELECTION_UNKNOWN'});
 assert.throws(()=>next.resolve('owner-mixed'),{code:'STACK_SELECTION_UNKNOWN'});
 assert.throws(()=>next.assertSelection(selection),{code:'STACK_SELECTION_UNKNOWN'});
});
