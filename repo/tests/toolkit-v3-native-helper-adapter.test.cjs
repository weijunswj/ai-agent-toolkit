'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const { HOST_ENTRIES } = require('../scripts/toolkit-v3-helper-guard.cjs');
const { renderNativeHelperDefinition, createNativeHelperAdapter, commandDecision, pinnedBindingObserver, resolveClaudeNativeState, verifyCodexHelperRegistration, CodexHookMatcher } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
const { capturedStack, TEST_PROFILES } = require('./support/captured-stack-fixture.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(entry_id) {
  const entry = HOST_ENTRIES[entry_id], profile = TEST_PROFILES[entry.host];
  const registry = compiler.contractSchema('stack-registry-v3.json');
  const qualification = Object.fromEntries(compiler.CHEAP_QUALIFIERS.map(key => [key,{status:'UNKNOWN',source:null}]));
  const captured=capturedStack(profile), route = captured.selection.routes.BUILDER_HELPER;
  let state = { state:'ready', host_version:'controlled-adapter-test (not native qualification)',
    registration:{...entry,registered:true,loaded:true,enabled:true},
    session:{caller_role:'G1',profile_id:profile,registry_revision:captured.selection.registry_digest,lifecycle:'fresh'},
    routing:{profile_id:profile,registry_revision:captured.selection.registry_digest,helper_role:'BUILDER_HELPER',
      effective_route:route,native_defaults:route,pinned_defaults:{provider:true,model:true,reasoning:true},inherited_route:null} };
  let dispatches = [], observe = () => clone(state);
  const adapter = createNativeHelperAdapter({source_capture:captured.source_capture,selection:captured.selection,entry_id,helper_identity:'ai-agent-toolkit:g1-helper',timeout_ms:5,
    observe_host_state: (...args) => observe(...args), dispatch_native: request => { dispatches.push(request); return { first_model_request:'intercepted', task_effects:0 }; },
    session_id:'parent',cwd:'owned',caller_model:'approved-lead'});
  const event={hook_event_name:'PreToolUse',tool_name:entry.entry,session_id:'parent',cwd:'owned',model:'approved-lead',tool_input:{subagent_type:'ai-agent-toolkit:g1-helper'}};
  return { captured,adapter,event,route,dispatches,get state(){return state},set state(s){state=s},set observe(fn){observe=fn} };
}
test('native adapter translation preserves original fifteen cases across every entry', async t => {
  for (const entry of Object.keys(HOST_ENTRIES)) {
    for (let id=1;id<=15;id++) await t.test(entry+' case '+id, async () => {
      const f=fixture(entry), e=clone(f.event);
      if(id===1) { e.tool_input.model=entry==='claude_parent_agent'?'claude-haiku-5-5':f.route.model; e.tool_input.effort=f.route.reasoning; }
      if(id===2) f.state.routing.effective_route={...f.route,provider:'wrong'};
      if(id===3) e.tool_input.effort='low';
      if(id===4) f.state.routing.inherited_route={...f.route,model:'wrong'};
      if(id===6) e.tool_input.model='wrong';
      if(id===7) f.observe=()=>{throw Error('hook exception')};
      if(id===8) { let n=0; f.observe=()=>++n===1?clone(f.state):new Promise(r=>setTimeout(()=>r(clone(f.state)),30)); }
      if(id===9) f.state.registration.enabled=false;
      if(id===10) delete f.state.routing.pinned_defaults.reasoning;
      if(id===11) {let n=0;f.observe=()=>{const s=clone(f.state);if(++n===3)s.host_version='changed';return s;};}
      if(id===12) e.tool_input.resume='old-helper';
      if(id===13) e.tool_name='unchecked-entry';
      if(id===14) f.state.session.caller_role='G1_HELPER';
      if(id===15) { assert.deepEqual(await commandDecision({tool_name:'Read'},'codex'),{}); assert.equal(f.dispatches.length,0); return; }
      const result=await f.adapter.invoke(e);
      assert.equal(result.decision,[1,5].includes(id)?'ALLOW':'DENY',result.code);
      assert.equal(f.dispatches.length,[1,5].includes(id)?1:0,'independent downstream observation');
      if(result.decision==='ALLOW') assert.deepEqual(f.dispatches[0].route,f.route);
    });
  }
});
test('native caller identity, leaf delegation and fully-qualified helper cannot be supplied by tool arguments',async()=>{
  for(const field of ['session_id','cwd','model']) {const f=fixture('codex_spawn_agent');f.event[field]='other';assert.equal((await f.adapter.invoke(f.event)).decision,'DENY');assert.equal(f.dispatches.length,0);}
  const f=fixture('claude_parent_agent');f.event.tool_input.subagent_type='g1-helper';assert.equal((await f.adapter.invoke(f.event)).code,'NATIVE_HELPER_IDENTITY_MISMATCH');
  f.event.tool_input.subagent_type='ai-agent-toolkit:g1-helper';f.event.agent_id='child';assert.equal((await f.adapter.invoke(f.event)).code,'NATIVE_LEAF_CANNOT_DELEGATE');
  assert.equal(f.dispatches.length,0);
});
test('real hook command denies missing binding and accepts a pinned controlled parent binding', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-native-hook-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f=fixture('codex_spawn_agent'),file=path.join(root,'binding.json');
  const envelope={source_capture:f.captured.source_capture,selection:f.captured.selection,schema:'toolkit.v3.native-helper-binding.v1',session_id:'parent',cwd:'owned',caller_model:'approved-lead',helper_identity:'ai-agent-toolkit:g1-helper',host_state:f.state};
  const bytes=Buffer.from(JSON.stringify(envelope)),digest=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);
  const script=path.resolve(__dirname,'../scripts/toolkit-codex-helper-hook.cjs');
  const env={...process.env,TOOLKIT_NATIVE_HELPER_BINDING:file,TOOLKIT_NATIVE_HELPER_BINDING_SHA256:digest};
  let r=spawnSync(process.execPath,[script],{input:JSON.stringify(f.event),encoding:'utf8',env,timeout:10000});
  // Codex rejects a bare permissionDecision:allow as unsupported output; an admitted request is exit 0 with no output.
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
  assert.equal((await commandDecision(f.event,'codex',{binding_path:file,binding_sha256:digest})).hookSpecificOutput.permissionDecision,'allow');
  fs.writeFileSync(file,JSON.stringify({...envelope,session_id:'tampered'}));
  r=spawnSync(process.execPath,[script],{input:JSON.stringify(f.event),encoding:'utf8',env,timeout:10000});
  assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision,'deny');
  assert.throws(()=>pinnedBindingObserver(file,digest)(),/NATIVE_BINDING_DRIFT/);
  assert.equal((await commandDecision(f.event,'codex')).hookSpecificOutput.permissionDecision,'deny');
});
test('Claude resolves actual precedence without treating force, aliases or allowlist substitutions as approval',()=>{
  const f=fixture('claude_parent_agent');
  const b={helper_identity:'ai-agent-toolkit:g1-helper',host_state:f.state,native_config:{loaded_agent:'ai-agent-toolkit:g1-helper',mods_present:false,provider:'anthropic',parent_model:'claude-opus-5-5',agent_model:'claude-haiku-5-5',agent_effort:'xhigh',session_effort:'high',available_models:['claude-haiku-5-5','claude-opus-5-5']}};
  assert.deepEqual(resolveClaudeNativeState(b,{},{}).routing.effective_route,f.route);
  assert.equal(resolveClaudeNativeState(b,{effort:'high'},{CLAUDE_CODE_EFFORT_LEVEL:'low'}).routing.effective_route.reasoning,'low');
  assert.equal(resolveClaudeNativeState(b,{}, {CLAUDE_CODE_SUBAGENT_MODEL_FORCE:'1'}).routing.effective_route.model,'opus-5.5');
  assert.throws(()=>resolveClaudeNativeState(b,{model:'haiku'},{}),/SUBSTITUTION_UNQUALIFIED/);
  b.native_config.mods_present=true;assert.throws(()=>resolveClaudeNativeState(b,{},{}),/CONFIG_UNVERIFIED/);
});
test('trusted launcher refuses missing, disabled and untrusted native hook registrations',()=>{
  const options={cwd:'owned',command:'approved-hook'},hook={eventName:'preToolUse',command:'approved-hook',matcher:'^(?:Agent|[A-Za-z0-9_-]*spawn_agent)$',enabled:true,trustStatus:'trusted'};
  const response={data:[{cwd:'owned',hooks:[hook],errors:[],warnings:[]}]};
  assert.equal(verifyCodexHelperRegistration(response,options).state,'REGISTRATION_VERIFIED');
  for(const field of ['enabled','trustStatus']){const r=clone(response);r.data[0].hooks[0][field]=field==='enabled'?false:'untrusted';assert.throws(()=>verifyCodexHelperRegistration(r,options),/NOT_TRUSTED/);}
  // Codex treats a pattern of only names and pipes as an exact list: it misses the flattened
  // MultiAgentV2 name, so the registration that let collaborationspawn_agent through is refused.
  for(const matcher of ['spawn_agent|Agent','^(spawn_agent|Agent)$']){const r=clone(response);r.data[0].hooks[0].matcher=matcher;assert.throws(()=>verifyCodexHelperRegistration(r,options),/NOT_TRUSTED/,matcher);}
  response.data[0].hooks=[];assert.throws(()=>verifyCodexHelperRegistration(response,options),/NOT_TRUSTED/);
});
// F1: Codex validates a MultiAgentV2 tool_namespace as [A-Za-z0-9_-]+. Registration is verified for the
// default, V1, default-V2, a hyphenated and the actually configured namespace; a matcher that omits any holds.
test('F1: registration verification probes a hyphenated and the configured tool namespace',()=>{
  const { CODEX_SPAWN_MATCHER } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
  const options={cwd:'owned',command:'approved-hook'},hook={eventName:'preToolUse',command:'approved-hook',enabled:true,trustStatus:'trusted'};
  const response=matcher=>({data:[{cwd:'owned',hooks:[{...hook,matcher}],errors:[],warnings:[]}]});
  // The 3.0.9 candidate matcher omitted `-`: it reported verified while hyphenated spawns escaped.
  assert.throws(()=>verifyCodexHelperRegistration(response('^(?:Agent|[A-Za-z0-9_]*spawn_agent)$'),options),/CODEX_REQUIRED_HOOK_NOT_TRUSTED/);
  assert.equal(verifyCodexHelperRegistration(response(CODEX_SPAWN_MATCHER),options).state,'REGISTRATION_VERIFIED');
  for(const ns of ['collaboration','multi-agent','Team_Alpha-2','-'])assert.equal(verifyCodexHelperRegistration(response(CODEX_SPAWN_MATCHER),{...options,tool_namespace:ns}).state,'REGISTRATION_VERIFIED',ns);
  // A matcher covering only the probe namespaces still holds for a different configured namespace.
  const narrow='^(?:Agent|(?:collaboration|multi-agent)?spawn_agent)$';
  assert.equal(verifyCodexHelperRegistration(response(narrow),options).state,'REGISTRATION_VERIFIED');
  assert.throws(()=>verifyCodexHelperRegistration(response(narrow),{...options,tool_namespace:'team_x'}),/CODEX_REQUIRED_HOOK_NOT_TRUSTED/);
  for(const ns of ['team.x','team x','',7,null])assert.throws(()=>verifyCodexHelperRegistration(response(CODEX_SPAWN_MATCHER),{...options,tool_namespace:ns}),/CODEX_TOOL_NAMESPACE_INVALID/,String(ns));
});
test('F1: the hook matcher and spawn recognition decide every Codex tool name identically',async t=>{
  const { CODEX_SPAWN_MATCHER, CodexDialect } = require('../scripts/toolkit-v3-native-helper-adapter.cjs');
  const shipped=new CodexHookMatcher(JSON.parse(fs.readFileSync(path.join(__dirname,'../../.codex-plugin/hooks/hooks.json'),'utf8')).hooks.PreToolUse[0].matcher);
  const spawns=['spawn_agent','Agent','collaborationspawn_agent','multi_agent_v1spawn_agent','multi-agentspawn_agent','collab-v2spawn_agent','Team_Alpha-2spawn_agent','-spawn_agent'];
  const others=['spawn_agents','Agents','Agent-x','list_agents','multi-agentlist_agents','multi.agentspawn_agent','multi agentspawn_agent','multi/agentspawn_agent','spawn_agentx','x-Agent','exec',''];
  for(const name of spawns){assert.equal(shipped.matches(name),true,name);assert.equal(CodexDialect.isSpawnRequest(name),true,name);}
  for(const name of others){assert.equal(shipped.matches(name),false,name);assert.equal(CodexDialect.isSpawnRequest(name),false,name);}
  assert.equal(new CodexHookMatcher(CODEX_SPAWN_MATCHER).matches('multi-agentspawn_agent'),true);
  // Bound positive and fork negative on a hyphenated namespace, at the same boundary as collaborationspawn_agent.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-native-hook-f1-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f=fixture('codex_spawn_agent'),file=path.join(root,'binding.json');
  const envelope={source_capture:f.captured.source_capture,selection:f.captured.selection,schema:'toolkit.v3.native-helper-binding.v1',session_id:'parent',cwd:'owned',caller_model:'approved-lead',helper_identity:f.event.tool_input.subagent_type,host_state:f.state};
  const bytes=Buffer.from(JSON.stringify(envelope)),digest=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);
  const options={binding_path:file,binding_sha256:digest},v2=input=>({...f.event,tool_name:'multi-agentspawn_agent',tool_input:{...f.event.tool_input,task_name:'leaf',message:'x',...input}});
  assert.equal((await commandDecision(v2({fork_turns:'none'}),'codex',options)).hookSpecificOutput.permissionDecision,'allow');
  for(const input of [{},{fork_turns:'all'},{fork_turns:'none',model:'other-model'}])assert.equal((await commandDecision(v2(input),'codex',options)).hookSpecificOutput.permissionDecision,'deny',JSON.stringify(input));
  assert.match((await commandDecision(v2({fork_turns:'none'}),'codex',{})).hookSpecificOutput.permissionDecisionReason,/NATIVE_BINDING_REQUIRED/);
});
test('Codex hook matcher semantics follow the host: exact pipe lists, unanchored regexes and match-all',()=>{
  const exact=new CodexHookMatcher('spawn_agent|Agent');
  assert.equal(exact.matches('spawn_agent'),true);assert.equal(exact.matches('collaborationspawn_agent'),false);assert.equal(exact.matches('Agentx'),false);
  const shipped=new CodexHookMatcher(JSON.parse(fs.readFileSync(path.join(__dirname,'../../.codex-plugin/hooks/hooks.json'),'utf8')).hooks.PreToolUse[0].matcher);
  for(const name of ['spawn_agent','Agent','collaborationspawn_agent','multi_agent_v1spawn_agent','teamspawn_agent'])assert.equal(shipped.matches(name),true,name);
  for(const name of ['spawn_agents','Agents','list_agents','collaborationlist_agents','send_message','exec','Bash'])assert.equal(shipped.matches(name),false,name);
  assert.equal(new CodexHookMatcher('').matches('anything'),true);assert.equal(new CodexHookMatcher('*').matches('x'),true);
  assert.equal(new CodexHookMatcher('spawn').matches('collaborationspawn_agent'),false);assert.equal(new CodexHookMatcher('spawn.*').matches('collaborationspawn_agent'),true);
});
test('Codex namespaced MultiAgentV2 spawns are guarded like spawn_agent, and only an explicit fork_turns none is fresh',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-native-hook-v2-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f=fixture('codex_spawn_agent'),file=path.join(root,'binding.json');
  const envelope={source_capture:f.captured.source_capture,selection:f.captured.selection,schema:'toolkit.v3.native-helper-binding.v1',session_id:'parent',cwd:'owned',caller_model:'approved-lead',helper_identity:f.event.tool_input.subagent_type,host_state:f.state};
  const bytes=Buffer.from(JSON.stringify(envelope)),digest=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);
  const options={binding_path:file,binding_sha256:digest},v2=input=>({...f.event,tool_name:'collaborationspawn_agent',tool_input:{...f.event.tool_input,task_name:'leaf',message:'x',...input}});
  // Same-boundary positive control: the V2 name with an explicit fresh child is admitted.
  assert.equal((await commandDecision(v2({fork_turns:'none'}),'codex',options)).hookSpecificOutput.permissionDecision,'allow');
  assert.equal((await commandDecision(v2({fork_turns:' NONE '}),'codex',options)).hookSpecificOutput.permissionDecision,'allow');
  for(const fork of [{},{fork_turns:'all'},{fork_turns:'ALL'},{fork_turns:'3'},{fork_turns:''},{fork_turns:null},{fork_context:true}]){
    const out=(await commandDecision(v2(fork),'codex',options)).hookSpecificOutput;
    assert.equal(out.permissionDecision,'deny',JSON.stringify(fork));assert.match(out.permissionDecisionReason,/NATIVE_SESSION_TRANSITION_UNQUALIFIED/);
  }
  // A V1-shaped spawn_agent stays fresh by default, but a V2 argument shape on it is checked the same way.
  assert.equal((await commandDecision(f.event,'codex',options)).hookSpecificOutput.permissionDecision,'allow');
  assert.equal((await commandDecision({...f.event,tool_input:{...f.event.tool_input,task_name:'leaf'}},'codex',options)).hookSpecificOutput.permissionDecision,'deny');
  // Wrong routes on the V2 name are refused before dispatch, exactly as on spawn_agent.
  for(const change of [{model:'other-model'},{reasoning_effort:'low'},{subagent_type:'unchecked-helper'}]){
    assert.equal((await commandDecision(v2({fork_turns:'none',...change}),'codex',options)).hookSpecificOutput.permissionDecision,'deny',JSON.stringify(change));
  }
  // Without a binding the V2 name is held in the governed checkout, through the real hook process.
  const script=path.resolve(__dirname,'../scripts/toolkit-codex-helper-hook.cjs'),env={...process.env};delete env.TOOLKIT_NATIVE_HELPER_BINDING;delete env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256;
  const r=spawnSync(process.execPath,[script],{input:JSON.stringify({hook_event_name:'PreToolUse',tool_name:'collaborationspawn_agent',cwd:path.resolve(__dirname,'../..'),tool_input:{task_name:'x',message:'x',fork_turns:'none'}}),encoding:'utf8',env,timeout:10000});
  assert.equal(r.status,2);assert.match(r.stderr,/NATIVE_BINDING_REQUIRED/);
});
test('native aliases, variants and inherited context cannot hide conflicting invocation values', async () => {
  for (const [entry, change] of [
    ['codex_spawn_agent', { fork_context: true }],
    ['claude_parent_agent', { agent_type: 'unchecked-helper' }],
  ]) {
    const f = fixture(entry);
    Object.assign(f.event.tool_input, change);
    assert.equal((await f.adapter.invoke(f.event)).decision, 'DENY');
    assert.equal(f.dispatches.length, 0);
  }
});
test('production helper-definition commands require source-pinned selection without launching or activating', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-definition-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const scripts = {codex:'toolkit-codex-helper-hook.cjs','claude-code':'toolkit-claude-agent-hook.cjs'};
  for (const [host,script] of Object.entries(scripts)) for (const role of ['G0','G1']) {
    const entry = Object.keys(HOST_ENTRIES).find(key => HOST_ENTRIES[key].host === host);
    const expected = fixture(entry).route;
    const rendered = renderNativeHelperDefinition(host,role,capturedStack(TEST_PROFILES[host]));
    assert.deepEqual(rendered.route,expected);
    assert.equal(rendered.qualification,'CONFIGURATION_GENERATED_ONLY');
    const selected=capturedStack(TEST_PROFILES[host]);
    const bytes=Buffer.from(JSON.stringify({source_capture:selected.source_capture,selection:selected.selection}));
    const file=path.join(root,'binding.json');fs.writeFileSync(file,bytes);
    const env={...process.env,TOOLKIT_NATIVE_HELPER_BINDING:file,TOOLKIT_NATIVE_HELPER_BINDING_SHA256:crypto.createHash('sha256').update(bytes).digest('hex')};
    const denied=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts',script),'--print-helper-definition',role],{encoding:'utf8',timeout:10000,env:{...env,TOOLKIT_NATIVE_HELPER_BINDING_SHA256:'0'.repeat(64)}});
    assert.ok(denied.status!==0 || JSON.parse(denied.stdout).hookSpecificOutput?.permissionDecision==='deny');
    const command = spawnSync(process.execPath,[path.resolve(__dirname,'../scripts',script),'--print-helper-definition',role],{encoding:'utf8',timeout:10000,env});
    assert.equal(command.status,0,command.stderr);
    assert.deepEqual(JSON.parse(command.stdout),rendered);
    if (host === 'claude-code') {
      assert.equal(rendered.native_configuration.model,'claude-haiku-5-5');
      assert.equal(rendered.native_configuration.effort,'xhigh');
      // One helper spec for both Claude renderers: the session definition carries the saved agent's tools and denies.
      const spec=require('../scripts/toolkit-claude-helper-spec.cjs').roleSpec(role);
      assert.deepEqual(rendered.native_configuration.tools,spec.tools);
      assert.deepEqual(rendered.native_configuration.disallowedTools,spec.disallowed);
      assert.equal(rendered.native_configuration.maxTurns,spec.maxTurns);
      assert.equal(rendered.native_configuration.description,spec.description);
      assert.ok(rendered.native_configuration.disallowedTools.includes('Agent')&&rendered.native_configuration.disallowedTools.includes('Task'));
      if (role==='G0') assert.equal(rendered.native_configuration.tools.some(tool=>['Bash','Edit','Write'].includes(tool)),false,'G0 is read-only');
    }
  }
  assert.throws(()=>renderNativeHelperDefinition('codex','G2'),/SELECTION_INVALID/);
  assert.throws(()=>renderNativeHelperDefinition('unqualified-host','G1'),/SELECTION_INVALID/);
});
