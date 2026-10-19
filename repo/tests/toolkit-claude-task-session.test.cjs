'use strict';
const { capturedStack } = require('./support/captured-stack-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const compiler=require('../scripts/toolkit-gate-contract-compiler.cjs');
const task=require('../scripts/toolkit-claude-task-session.cjs');
const {createDispatchObserver,createParentDispatchGate,createSdkHostControlHandler}=require('../scripts/toolkit-claude-dispatch-observer.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-task-qualified-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const profile=task.createTaskSessionProfile({ ...capturedStack('owner-claude'),control_root:root,cwd:root,session_id:'controlled-parent',role:'G1'});
 const route={provider:'anthropic',model:'haiku-5.5',reasoning:'xhigh'};
 let host={state:'ready',host_version:'controlled-local-protocol-fixture; NOT native qualification',
 registration:{host:'claude-code',api_generation:'PreToolUse',entry:'Agent',registered:true,loaded:true,enabled:true},
 session:{caller_role:'G1',profile_id:'owner-claude',registry_revision:profile.registry_revision,lifecycle:'fresh'},
 routing:{profile_id:'owner-claude',registry_revision:profile.registry_revision,helper_role:'BUILDER_HELPER',effective_route:route,native_defaults:route,pinned_defaults:{provider:true,model:true,reasoning:true},inherited_route:null}};
 let disposition={state:'ROOT_ADMITTED',disposition_id:'SYNTHETIC-TEST-DISPOSITION',counter_reference:'a'.repeat(64),resource_admission_reference:'b'.repeat(64),parent_invocation_bound_reference:'c'.repeat(64),max_inflight_helpers:1,max_helper_dispatches:2,existing_helper_consumption:0,per_invocation_timeout_ms:1000,aggregate_timeout_ms:10000,native_control_verified:true,route_immutable_after_boundary:true};
 let clock=1000;const observations=[],observer=createDispatchObserver({write_observation:x=>observations.push(x)});
 const gate=()=>createParentDispatchGate({profile,observe_host_state:()=>clone(host),read_root_disposition:()=>clone(disposition),observer,now:()=>clock,
 interrupt_native:()=>({state:'CONTROLLED_INTERRUPT_ONLY'}),read_native_settlement:r=>({attempt_id:r.id,child_id:r.child_id,descendants_settled:true,domain:'CONTROLLED_LOCAL_FIXTURE'})});
 const event=id=>({hook_event_name:'PreToolUse',tool_name:'Agent',session_id:profile.session_id,cwd:root,tool_use_id:id,tool_input:{subagent_type:profile.helper_identity}});
 const pre=e=>task.taskPrecheck(e,{profile,native_guard:{helper_identity:profile.helper_identity,observe_host_state:()=>clone(host)}});
 const meta=e=>({session_id:profile.session_id,tool_use_id:e.tool_use_id});
 return{root,profile,route,observations,observer,gate,event,pre,meta,get host(){return host},set host(v){host=v},get disposition(){return disposition},set disposition(v){disposition=v},set clock(v){clock=v}};
}
test('task profile binds exact source routes and mandatory host ask without selecting broader-native',t=>{
 const f=fixture(t),config=task.renderSessionConfiguration(f.profile,path.resolve(__dirname,'../scripts/toolkit-claude-agent-hook.cjs'));
 assert.equal(f.profile.purpose,'QUALIFICATION_ONLY');assert.equal(f.profile.inference_authority,'NONE_FROM_PROFILE');
 assert.deepEqual(f.profile.parent,{model:'claude-opus-5-5',effort:'high'});
 assert.equal(f.profile.helper.model,'claude-haiku-5-5');assert.equal(f.profile.helper.effort,'xhigh');
 assert.deepEqual(config.settings.permissions.ask,['Agent','Task']);assert.equal(config.settings.hooks.PreToolUse[0].hooks[0].timeout,10);
 assert.deepEqual(config.agents['toolkit-g1-helper'].disallowedTools,['Agent','Task']);
 assert.equal(JSON.stringify(f.profile).includes('broader-native'),false);
 const changed=clone(f.profile);changed.resource_control.consumption_bounds=15;assert.throws(()=>task.validateTaskSessionProfile(changed),/PROFILE_DRIFT/);
});
test('actual task profile file is pinned and neither raw arguments nor global profile can select it',t=>{
 const f=fixture(t),file=path.join(f.root,'profiles','claude-task-session.json');fs.mkdirSync(path.dirname(file));const bytes=Buffer.from(JSON.stringify(f.profile));fs.writeFileSync(file,bytes);
 const pin=crypto.createHash('sha256').update(bytes).digest('hex');assert.deepEqual(task.readPinnedTaskProfile(f.root,pin),f.profile);
 fs.writeFileSync(file,JSON.stringify({...f.profile,session_id:'changed'}));assert.throws(()=>task.readPinnedTaskProfile(f.root,pin),/PIN_DRIFT/);
 assert.throws(()=>task.createTaskSessionProfile({ ...capturedStack('owner-claude'),control_root:path.join(os.homedir(),'.ai-agent-toolkit','agent-control'),cwd:f.root,session_id:'parent'}),/GLOBAL_PROFILE_FORBIDDEN/);
});
test('real parent command precheck requests mandatory host callback; exact final gate rechecks before controlled execution',async t=>{
 const f=fixture(t),e=f.event('positive');assert.equal((await f.pre(e)).hookSpecificOutput.permissionDecision,'ask');
 const g=f.gate(),answer=await g.canUseTool('Agent',e.tool_input,f.meta(e));assert.equal(answer.behavior,'allow',answer.message);
 assert.equal(g.inspect().consumed,1);assert.equal(f.observations[0].type,'FINAL_PERMISSION_BOUNDARY');assert.equal(f.observations[0].guard_escape,false);
 assert.equal(f.observations[0].first_model_request,'NOT_OBSERVED');
 g.observeLifecycle('CREATION_OBSERVED',{attempt_id:answer.toolkit_attempt_id,child_id:'controlled-child'});
 g.observeLifecycle('MODEL_REQUEST_OBSERVED',{attempt_id:answer.toolkit_attempt_id,child_id:'controlled-child',route_digest:compiler.hashCanonical(f.route),domain:'CONTROLLED_FAKE_PROVIDER'});
 g.observeLifecycle('TERMINAL_OBSERVED',{attempt_id:answer.toolkit_attempt_id,child_id:'controlled-child',descendants_settled:true});
 assert.equal(g.inspect().active,null);assert.equal(g.inspect().consumed,1);
});
test('external one-at-a-time, finite consumption and replay survive fresh gate instances without reset',async t=>{
 const f=fixture(t),g=f.gate(),e=f.event('first');await f.pre(e);const first=await g.canUseTool('Agent',e.tool_input,f.meta(e));assert.equal(first.behavior,'allow');
 const e2=f.event('second');await f.pre(e2);assert.match((await f.gate().canUseTool('Agent',e2.tool_input,f.meta(e2))).message,/INFLIGHT/);
 assert.match((await f.gate().canUseTool('Agent',e.tool_input,f.meta(e))).message,/REPLAY/);
 g.observeLifecycle('CREATION_OBSERVED',{attempt_id:first.toolkit_attempt_id,child_id:'one'});g.observeLifecycle('TERMINAL_OBSERVED',{attempt_id:first.toolkit_attempt_id,child_id:'one',descendants_settled:true});
 const second=await f.gate().canUseTool('Agent',e2.tool_input,f.meta(e2));assert.equal(second.behavior,'allow');
 const fresh=f.gate();fresh.observeLifecycle('CREATION_OBSERVED',{attempt_id:second.toolkit_attempt_id,child_id:'two'});fresh.observeLifecycle('TERMINAL_OBSERVED',{attempt_id:second.toolkit_attempt_id,child_id:'two',descendants_settled:true});
 const e3=f.event('third');await f.pre(e3);assert.match((await f.gate().canUseTool('Agent',e3.tool_input,f.meta(e3))).message,/EXHAUSTED/);assert.equal(f.gate().inspect().consumed,2);
});
test('missing/denied precheck, hook error, drift, wrong final route and unbound resource disposition preserve zero approval',async t=>{
 for(const kind of ['missing','denied','error','input-drift','route-drift','resources'])await t.test(kind,async t=>{
 const f=fixture(t),e=f.event(kind),g=f.gate();
 if(kind==='denied')e.tool_input.model='claude-opus-5-5';
 if(kind==='error'){f.host.state='error';}
 if(kind!=='missing')await f.pre(e);
 if(kind==='input-drift')e.tool_input.effort='low';
 if(kind==='route-drift')f.host.routing.effective_route={...f.route,reasoning:'high'};
 if(kind==='resources')f.disposition={state:'PENDING_ROOT_DISPOSITION'};
 const answer=await g.canUseTool('Agent',e.tool_input,f.meta(e));assert.equal(answer.behavior,'deny');assert.equal(g.inspect().state,'NO_HELPER_DISPATCH_ADMITTED');
 assert.equal(f.observations.every(x=>x.child_created===false),true);
 });
});
test('child/fork/alias/role transitions and changed resource bounds cannot evade the final gate',async t=>{
 for(const kind of ['leaf','fork','alias','G2','bounds-drift'])await t.test(kind,async t=>{
 const f=fixture(t),g=f.gate(),e=f.event(kind);
 if(kind==='fork')e.tool_input.fork=true;if(kind==='G2')f.host.session.caller_role='G2';await f.pre(e);
 if(kind==='bounds-drift'){const first=await g.canUseTool('Agent',e.tool_input,f.meta(e));assert.equal(first.behavior,'allow');f.disposition.max_helper_dispatches=3;const other=f.event('other');await f.pre(other);assert.match((await g.canUseTool('Agent',other.tool_input,f.meta(other))).message,/DISPOSITION/);return;}
 const info={...f.meta(e),...(kind==='leaf'?{agent_id:'leaf'}:{})};const answer=await g.canUseTool(kind==='alias'?'Task':'Agent',e.tool_input,info);assert.equal(answer.behavior,'deny');assert.equal(g.inspect().state,'NO_HELPER_DISPATCH_ADMITTED');
 });
});
test('supported can_use_tool control message reaches the independent gate and unsupported messages have no effect',async t=>{
 const f=fixture(t),g=f.gate(),e=f.event('control');await f.pre(e);
 const response=await g.handleControlRequest({type:'control_request',request_id:'r1',request:{subtype:'can_use_tool',tool_name:'Agent',tool_use_id:e.tool_use_id,input:e.tool_input}});
 assert.equal(response.behavior,'allow',response.message);assert.throws(()=>g.handleControlRequest({type:'control_request',request:{subtype:'initialize'}}),/UNSUPPORTED/);
});
test('deadline interruption settles only the exact observed child; consumption persists and ambiguity never replays',async t=>{
 const f=fixture(t),g=f.gate(),e=f.event('timeout');await f.pre(e);const a=await g.canUseTool('Agent',e.tool_input,f.meta(e));
 assert.equal(a.behavior,'allow');g.observeLifecycle('CREATION_OBSERVED',{attempt_id:a.toolkit_attempt_id,child_id:'owned-child'});
 await assert.rejects(g.enforceDeadline(a.toolkit_attempt_id),/NOT_EXPIRED/);f.clock=2100;
 await g.enforceDeadline(a.toolkit_attempt_id);assert.equal(g.inspect().active,null);assert.equal(g.inspect().consumed,1);
 const e2=f.event('ambiguous');await f.pre(e2);const a2=await g.canUseTool('Agent',e2.tool_input,f.meta(e2));assert.equal(a2.behavior,'allow');f.clock=3200;
 await assert.rejects(g.enforceDeadline(a2.toolkit_attempt_id),/SETTLEMENT_UNPROVEN/);
 await assert.rejects(g.enforceDeadline(a2.toolkit_attempt_id),/UNKNOWN_NO_REPLAY/);assert.equal(g.inspect().consumed,2);assert.equal(g.inspect().active,a2.toolkit_attempt_id);
});
test('installed command entry reads only pinned task profile and writes exact precheck receipt without global activation',t=>{
 const f=fixture(t),e=f.event('command'),profileFile=path.join(f.root,'profiles/claude-task-session.json');fs.mkdirSync(path.dirname(profileFile));
 const profileBytes=Buffer.from(JSON.stringify(f.profile));fs.writeFileSync(profileFile,profileBytes);
 const binding={source_capture:f.profile.source_capture,selection:f.profile.selection,schema:'toolkit.v3.native-helper-binding.v1',session_id:f.profile.session_id,cwd:f.root,caller_model:'claude-opus-5-5',helper_identity:f.profile.helper_identity,host_state:f.host,
 native_config:{loaded_agent:f.profile.helper_identity,mods_present:false,provider:'anthropic',available_models:['claude-opus-5-5','claude-haiku-5-5'],parent_model:'claude-opus-5-5',agent_model:'claude-haiku-5-5',agent_effort:'xhigh',session_effort:'high'}};
 const bindingBytes=Buffer.from(JSON.stringify(binding)),bindingFile=path.join(f.root,'binding.json');fs.writeFileSync(bindingFile,bindingBytes);
 const env={...process.env,AI_AGENT_TOOLKIT_CONTROL_ROOT:f.root,TOOLKIT_CLAUDE_TASK_PROFILE_SHA256:crypto.createHash('sha256').update(profileBytes).digest('hex'),TOOLKIT_NATIVE_HELPER_BINDING:bindingFile,TOOLKIT_NATIVE_HELPER_BINDING_SHA256:crypto.createHash('sha256').update(bindingBytes).digest('hex')};
 const cp=require('node:child_process'),command=path.resolve(__dirname,'../scripts/toolkit-claude-agent-hook.cjs');
 const result=cp.spawnSync(process.execPath,[command],{input:JSON.stringify(e),env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,'ask');
 assert.equal(JSON.parse(fs.readFileSync(task.receiptPath(f.profile,e.tool_use_id))).decision,'ROUTE_PRECHECK_PASSED');
 assert.equal(fs.existsSync(path.join(f.root,'profiles/claude-code.json')),false,'qualification never rewrites/selects global production topology');
});
test('SDK host response is native-shaped and independent receiver performs controlled work only after allow',async t=>{
 const f=fixture(t),e=f.event('sdk-response');await f.pre(e);let work=0;const received=[];
 const handler=createSdkHostControlHandler({gate:f.gate(),send_control_response:frame=>{received.push(frame);if(frame.response.response.behavior==='allow')work++;}});
 await handler({type:'control_request',request_id:'allowed',request:{subtype:'can_use_tool',tool_name:'Agent',tool_use_id:e.tool_use_id,input:e.tool_input}});
 await handler({type:'control_request',request_id:'missing',request:{subtype:'can_use_tool',tool_name:'Agent',tool_use_id:'missing',input:e.tool_input}});
 assert.equal(work,1);assert.deepEqual(Object.keys(received[0].response.response).sort(),['behavior','updatedInput']);
 assert.equal(received[1].response.response.behavior,'deny');assert.equal(received[1].response.request_id,'missing');
 assert.equal(f.observations[1].guard_escape,true,'independent final boundary marks escaped/missing primary proof');
});
test('separate controlled receiver cannot execute after a denied primary escapes; valid control reaches real source gate',async t=>{
 for(const mode of ['valid','primary-deny-escaped'])await t.test(mode,async t=>{
 const f=fixture(t),e=f.event(mode);if(mode==='primary-deny-escaped')e.tool_input.model='claude-opus-5-5';
 const primary=await f.pre(e);assert.equal(primary.hookSpecificOutput.permissionDecision,mode==='valid'?'ask':'deny');
 const cp=require('node:child_process'),marker=path.join(f.root,'controlled-model-boundary.json');
 const message={type:'control_request',request_id:'fixture-request',request:{subtype:'can_use_tool',tool_name:'Agent',tool_use_id:e.tool_use_id,input:e.tool_input}};
 // This engine is deliberately fake. Only the candidate profile/hook/gate/SDK
 // transport are real implementations; no provider or native PASS is claimed.
 const fake='const fs=require("fs");console.log(process.argv[2]);let s="";process.stdin.on("data",b=>{s+=b;const at=s.indexOf("\\n");if(at<0)return;const frame=JSON.parse(s.slice(0,at));if(frame.response.response.behavior==="allow")fs.writeFileSync(process.argv[1],JSON.stringify({domain:"CONTROLLED_FAKE_MODEL_BOUNDARY",pid:process.pid}),{flag:"wx"});process.exit(0);});';
 const child=cp.spawn(process.execPath,['-e',fake,marker,JSON.stringify(message)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const g=f.gate(),handler=createSdkHostControlHandler({gate:g,send_control_response:frame=>child.stdin.write(JSON.stringify(frame)+'\n')});
 let line='';let protocol;
 child.stdout.on('data',b=>{line+=b;const at=line.indexOf('\n');if(at>=0&&!protocol)protocol=handler(JSON.parse(line.slice(0,at)));});
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
 const timer=setTimeout(()=>child.kill(),10000);const code=await ended;clearTimeout(timer);await protocol;
 assert.equal(code,0);assert.equal(fs.existsSync(marker),mode==='valid');
 assert.equal(g.inspect().consumed,mode==='valid'?1:undefined);
 assert.equal(f.observations[0].guard_escape,mode!=='valid');
 });
});
