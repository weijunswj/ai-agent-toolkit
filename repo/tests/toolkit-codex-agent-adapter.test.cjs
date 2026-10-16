'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const adapter=require('../scripts/toolkit-codex-agent-adapter.cjs'),agent=require('../scripts/toolkit-agent-control.cjs'),receipts=require('../scripts/toolkit-github-program-receipt.cjs');
test('owned production helper preflight verifies canonical SessionStart without granting raw native subagent permission', async () => {
 const root=path.resolve(__dirname,'../..'),command='node "'+path.resolve(__dirname,'../scripts/toolkit-codex-session-start.cjs')+'" --hook --sync-enabled --write --sync-source codex-plugin';
 let downstream=0,requests=[];
 const response={data:[{cwd:root,hooks:[{eventName:'sessionStart',handlerType:'command',command,matcher:'startup|resume|clear|compact',enabled:true,trustStatus:'trusted'}],errors:[],warnings:[]}]};
 const client={request:async(method,params)=>{requests.push({method,params});return response;}};
 const ready=await adapter.verifyNativeHelperRegistration(client,root);downstream++;
 assert.equal(ready.state,'CANONICAL_SESSION_START_READY');assert.equal(ready.qualification,'UNQUALIFIED_UNTIL_NATIVE_MATRIX');assert.equal(ready.unmanaged_native_subagent_permission,false);
 assert.equal(downstream,1);assert.deepEqual(requests,[{method:'hooks/list',params:{cwds:[root]}}]);
 for (const patch of [{trustStatus:'untrusted'},{enabled:false},{matcher:'startup'},{command:'node unrelated-hook.cjs'},{eventName:'preToolUse'},{handlerType:'prompt'},{async:true}]) {
   const previous=response.data[0].hooks[0];response.data[0].hooks[0]={...previous,...patch};
   await assert.rejects(adapter.verifyNativeHelperRegistration(client,root),/NOT_TRUSTED/);
   response.data[0].hooks[0]=previous;
 }
 assert.equal(downstream,1,'independent continuation remains blocked by unqualified registration');
 await assert.rejects(adapter.verifyNativeHelperRegistration(null,root),/REGISTRATION_REQUIRED/);
});
// Synthetic data-only core fixture. It cannot create an admission, native proof or successful effect.
const { currentControllerFixture: coreDecisionFixture } = require('./support/current-controller-fixture.cjs');

test('Fake stores/channels/adapters cannot reach a spawn, writer or receiver through exported compatibility paths',async()=>{
 let effects=0;const fake={snapshot(){effects++;return coreDecisionFixture();},qualification(){effects++;return {qualified:true};},prepare(){effects++;return {};},run(){effects++;return {status:'COMPLETED'};}};
 assert.throws(()=>adapter.createCodexAdapter(fake,path.resolve(__dirname,'../..')));
 assert.throws(()=>receipts.createControllerEffectChannel(fake,{},fake,{}));
 await assert.rejects(()=>agent.coreRuntimeCommand('core-run',fake,{role:'BUILDER',instruction:'synthetic'}));assert.equal(effects,0);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mode0-nonauth-'));
 try{
  const worker={host:'claude-code',role:'worker',depth:1,estimated_memory_bytes:agent.GIB,
   child_responsibility:'Implement the isolated bounded resource test.',parent_responsibility:'Retain integration and validation responsibility.',
   integration_plan:'The parent integrates the result.',validation_plan:'The parent reviews the exact output.',material_benefit:'A bounded worker can complete a separable task.',
   tasks_separable:true,concurrent_execution_possible:true,expected_wall_clock_speedup:'The worker can finish sooner.',
   root_retains_longest_or_critical_path:true,child_task_is_shorter_or_easier:true,root_productive_work_declared:true,
   child_prompt:'Implement the isolated bounded resource test.'};
  const refusal=await agent.admissionDecisionWithResourceEnvelope(worker,fake,{root,resourceState:{source:'proc-meminfo',overcommit_mode:0}});
  assert.equal(refusal.result,agent.RESULTS.REFUSE);
  assert.equal(fs.existsSync(agent.statePath({root})),false);
  assert.equal(fs.existsSync(path.join(root,'jobs')),false);
 }finally{fs.rmSync(root,{recursive:true,force:false});}
 assert.equal(effects,0);
});
test('Absent confinement proof holds without executable access or a model turn',()=>{
 const {decision}=coreDecisionFixture();
 assert.throws(()=>adapter.validateHostQualification({qualified:true},{decision},'BUILDER','synthetic-root'));
 assert.throws(()=>adapter.validateHostQualification(new Proxy({},{ownKeys(){throw Error('Proxy hook');}}),{decision},'BUILDER','synthetic-root'));
});
test('Discovery and builder leads can request only their distinct leaf roles; helper and review roles cannot nest',()=>{
 const discovery=adapter.toolDefinitions('DISCOVERY');assert.deepEqual(discovery.map(t=>t.name),['toolkit_read','toolkit_search','toolkit_request_helper']);
 const builder=adapter.toolDefinitions('BUILDER');assert.equal(builder.length,5);assert.equal(builder.find(t=>t.name==='toolkit_validate').inputSchema.additionalProperties,false);
 assert.deepEqual(builder.find(t=>t.name==='toolkit_validate').inputSchema.required,['case_id']);
 assert.deepEqual(builder.find(t=>t.name==='toolkit_request_helper').inputSchema.properties.role.enum,['DISCOVERY_HELPER','BUILDER_HELPER']);
 assert.deepEqual(adapter.toolDefinitions('DISCOVERY_HELPER',true).map(t=>t.name),['toolkit_read','toolkit_search']);
 assert.deepEqual(adapter.toolDefinitions('BUILDER_HELPER',true).map(t=>t.name),['toolkit_read','toolkit_search','toolkit_apply_patch','toolkit_validate']);
 for(const role of ['REVIEW','REVIEW_SCOPE','REVIEW_EXECUTION'])assert.deepEqual(adapter.toolDefinitions(role).map(t=>t.name),['toolkit_read','toolkit_search']);
 assert.equal(adapter.toolDefinitions('BUILDER',true).some(t=>t.name==='toolkit_request_helper'),false);
 assert.throws(()=>adapter.createCodexAdapter({},path.resolve(__dirname,'../..'),{}));
});
test('Actual agent-control CLI effects remain zero when no installed authentic context is present',()=>{
 const root=path.resolve(__dirname,'../..');
 for(const command of ['core-run','core-recover','core-qualify']){
  const result=cp.spawnSync(process.execPath,[path.join(root,'repo/scripts/toolkit-agent-control.cjs'),command],{cwd:root,shell:false,windowsHide:true,encoding:'utf8',timeout:10000});
  assert.equal(result.status,2,result.stderr);const body=JSON.parse(result.stdout);assert.equal(body.status,'HOLD');assert.equal(body.code,'CORE_AUTHENTIC_INSTALLED_CONTEXT_REQUIRED');
 }
});
test('Actual effect-free installed entrypoint selects the same complete decision and records plan-only status',()=>{
 const root=path.resolve(__dirname,'../..'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'core-entrypoint-')),input=path.join(fixture,'decision.json');
 const {decision}=coreDecisionFixture();fs.writeFileSync(input,JSON.stringify(decision));
 const result=cp.spawnSync(process.execPath,[path.join(root,'repo/scripts/toolkit-agent-control.cjs'),'core-inspect','--input',input],{cwd:root,shell:false,windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),adapter.inspect(decision));
});
test('Resolved native response rejects reroutes and policy drift before a productive turn',()=>{
 const route={provider:'openai',model:'fixture-model',reasoning:'high'},root=path.resolve(__dirname,'../..');
 const fields={model:route.model,modelProvider:route.provider,reasoningEffort:route.reasoning,cwd:root,approvalPolicy:'never',sandbox:{type:'readOnly'},instructionSources:[path.join(root,'AGENTS.md')]};
 const proof={resolved_thread:fields},response={...fields,thread:{id:'synthetic-thread'}};
 assert.equal(adapter.validateResolvedThread(response,proof,route,root).thread,'synthetic-thread');
 assert.equal(adapter.validateResolvedThread({...response,serviceTier:'standard'},proof,route,root).thread,'synthetic-thread');
 for(const patch of [{model:'other'},{modelProvider:'other'},{reasoningEffort:'max'},{cwd:'other'},{approvalPolicy:'always'},{sandbox:{type:'workspaceWrite'}},{instructionSources:[]}])
   assert.throws(()=>adapter.validateResolvedThread({...response,...patch},proof,route,root));
});
test('Launcher service tier is optional controller config and model/effort proof needs no tier receipt',()=>{
 const root=path.resolve(__dirname,'../..');
 const qualification={thread_start:{model:'ignored',modelProvider:'openai',cwd:root,approvalPolicy:'never',sandbox:'read-only',config:{model_reasoning_effort:'high'}},
  turn_start:{model:'ignored',effort:'high',cwd:root,approvalPolicy:'never',sandboxPolicy:{type:'readOnly',access:{type:'restricted',includePlatformDefaults:false,readableRoots:[root]}}},
  binding:{qualification_digest:'a'.repeat(64)}};
 function request(model,reasoning,role='BUILDER',launchConfig=null,helper=false){
  const route={provider:'openai',model,reasoning},snapshot={decision_digest:'b'.repeat(64),decision:{selection:{routes:{[role]:route}}}};
  const q=JSON.parse(JSON.stringify(qualification));q.thread_start.model=model;q.thread_start.config.model_reasoning_effort=reasoning;
  q.turn_start.model=model;q.turn_start.effort=reasoning;
  return adapter.buildNativeRequest(snapshot,q,role,'bounded test',helper,launchConfig);
 }
 assert.equal(request('gpt-6.1-sol','high').thread_start.serviceTier,undefined);
 assert.equal(request('gpt-6.1-sol','high').thread_start.allowProviderModelFallback,false);
 assert.equal(request('gpt-6-luna','max','BUILDER_HELPER',null,true).thread_start.allowProviderModelFallback,false);
 assert.equal(request('gpt-6-luna','max','BUILDER_HELPER',null,true).thread_start.serviceTier,undefined);
 assert.equal(request('gpt-6-astra','high','REVIEW_EXECUTION').thread_start.serviceTier,undefined);
 assert.equal(request('gpt-6.1-sol','high','DISCOVERY',{serviceTier:'default'}).thread_start.serviceTier,'default');
 assert.throws(()=>request('gpt-6.1-sol','high','DISCOVERY',{serviceTier:'default'},true),/CORE_HELPER_LAUNCH_CONFIG_FORBIDDEN/);
 assert.throws(()=>request('gpt-6.1-sol','high','DISCOVERY',{serviceTier:' '}),/CORE_LAUNCH_CONFIG_INVALID/);
 assert.throws(()=>request('gpt-6.1-sol','high','DISCOVERY',{serviceTier:'default',source:'worker'}),/CORE_LAUNCH_CONFIG_INVALID/);
 const resolved={model:'gpt-6.1-sol',modelProvider:'openai',reasoningEffort:'high',cwd:root,approvalPolicy:'never',sandbox:{type:'readOnly'},instructionSources:[path.join(root,'AGENTS.md')]};
 const result=adapter.validateResolvedThread({...resolved,thread:{id:'no-tier-receipt'}},{resolved_thread:resolved},
  {provider:'openai',model:'gpt-6.1-sol',reasoning:'high'},root);
 assert.equal(result.thread,'no-tier-receipt');
 assert.throws(()=>adapter.validateResolvedThread({...resolved,reasoningEffort:'max',thread:{id:'wrong-effort'}},{resolved_thread:resolved},
  {provider:'openai',model:'gpt-6.1-sol',reasoning:'high'},root));
});
