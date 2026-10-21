'use strict';
const { capturedStack } = require('./support/captured-stack-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const task=require('../scripts/toolkit-claude-task-session.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-task-qualified-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const profile=task.createTaskSessionProfile({ ...capturedStack('owner-claude'),control_root:root,cwd:root,session_id:'controlled-parent',role:'G1'});
 const route={provider:'anthropic',model:'haiku-5.5',reasoning:'xhigh'};
 let host={state:'ready',host_version:'controlled-local-protocol-fixture; NOT native qualification',
 registration:{host:'claude-code',api_generation:'PreToolUse',entry:'Agent',registered:true,loaded:true,enabled:true},
 session:{caller_role:'G1',profile_id:'owner-claude',registry_revision:profile.registry_revision,lifecycle:'fresh'},
 routing:{profile_id:'owner-claude',registry_revision:profile.registry_revision,helper_role:'BUILDER_HELPER',effective_route:route,native_defaults:route,pinned_defaults:{provider:true,model:true,reasoning:true},inherited_route:null}};
 const event=id=>({hook_event_name:'PreToolUse',tool_name:'Agent',session_id:profile.session_id,cwd:root,tool_use_id:id,tool_input:{subagent_type:profile.helper_identity}});
 const pre=e=>task.taskPrecheck(e,{profile,native_guard:{helper_identity:profile.helper_identity,observe_host_state:()=>clone(host)}});
 const meta=e=>({session_id:profile.session_id,tool_use_id:e.tool_use_id});
 return{root,profile,route,event,pre,meta,get host(){return host},set host(v){host=v}};
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
