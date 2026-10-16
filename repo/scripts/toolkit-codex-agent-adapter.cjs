#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const receipts = require('./toolkit-github-program-receipt.cjs');
const ADAPTERS = new WeakMap(), HELPERS = new WeakMap();
const TOOLS = Object.freeze(['toolkit_read','toolkit_search','toolkit_apply_patch','toolkit_validate','toolkit_request_helper']);
const CONFINEMENT_BOUNDARIES = Object.freeze(['native_shell','native_patch','connectors','network','native_subagent','path_alias','unexpected_server_request','interrupted_turn','stale_current']);
const MAX_BYTES = 1024 * 1024;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => compiler.hashCanonical(a) === compiler.hashCanonical(b);
function hold(code) {
  const error = new Error('Toolkit core action held. Reference: ' + code);
  error.code = code;
  throw error;
}
async function verifyNativeHelperRegistration(client, cwd) {
  if (!client || typeof client.request !== 'function') hold('CORE_NATIVE_HELPER_REGISTRATION_REQUIRED');
  const response = compiler.trustedJsonCopy(await client.request('hooks/list', { cwds: [cwd] }));
  const entry = response?.data?.find(item => item.cwd === cwd);
  const command = 'node "' + path.resolve(__dirname, 'toolkit-codex-session-start.cjs')
    + '" --hook --sync-enabled --write --sync-source codex-plugin';
  if (!entry || entry.errors?.length || entry.warnings?.length || !Array.isArray(entry.hooks)) hold('CODEX_SESSION_START_UNVERIFIED');
  const hook = entry.hooks.find(item => item.eventName === 'sessionStart' && item.handlerType === 'command'
    && item.command === command && item.matcher === 'startup|resume|clear|compact');
  if (!hook || hook.enabled !== true || hook.async === true || !['trusted','managed'].includes(hook.trustStatus)) hold('CODEX_SESSION_START_NOT_TRUSTED');
  // This proves canonical startup readiness only. The actual helper boundary is
  // our owned item/tool/call -> toolkit_request_helper receiver below; authentic
  // channel authority, independent confinement/route/resource qualification and
  // exact helper request validation still precede process or turn dispatch.
  // Raw spawn_agent/Agent do not acquire permission from this metadata result.
  return Object.freeze({state:'CANONICAL_SESSION_START_READY',qualification:'UNQUALIFIED_UNTIL_NATIVE_MATRIX',cwd,
    helper_boundary:'OWNED_TOOLKIT_REQUEST_HELPER',unmanaged_native_subagent_permission:false});
}
function closed(value, keys) {
  value = compiler.trustedJsonCopy(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) hold('CORE_REQUEST_INVALID');
  return value;
}
function state(adapter) {
  const owner = ADAPTERS.get(adapter);
  if (!owner || owner.process !== process.pid) hold('CORE_ADMISSION_REQUIRED');
  receipts.assertAuthenticControllerEffectChannel(owner.channel);
  return owner;
}
function sourceObservations(refs, observations) {
  if (!Array.isArray(observations) || observations.length !== refs.length) hold('HOST_SURFACE_UNQUALIFIED');
  const seen = new Set();
  for (const input of observations) {
    const item = closed(input,['reference','content_base64']);
    const ref = refs.find(r => r.id === item.reference.id);
    if (!ref || seen.has(ref.id) || !same(ref,item.reference) || typeof item.content_base64 !== 'string') hold('HOST_SURFACE_UNQUALIFIED');
    const bytes = Buffer.from(item.content_base64,'base64');
    if (!bytes.length || bytes.toString('base64') !== item.content_base64 || sha(bytes) !== ref.content_sha256) hold('HOST_SURFACE_UNQUALIFIED');
    if (ref.blob_sha1 !== null && crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex') !== ref.blob_sha1) hold('HOST_SURFACE_UNQUALIFIED');
    seen.add(ref.id);
  }
}
// Data validation is never native qualification or admission. Only the captured host reader supplies this to a live channel.
function validateHostQualification(input, snapshot, role, root, executionContext=null, reviewerId=null) {
  const value = closed(input,['binding','expires_at','boundaries','observations','thread_start','turn_start','resource_envelope','resolved_thread','protocol_source','execution_context']);
  compiler.checkCoreSchema(value.binding,compiler.contractSchema(snapshot.decision.schema==='toolkit.controller-decision.v2'?'codex-host-adapter-v2.schema.json':'codex-host-adapter-v1.schema.json'));
  const current=snapshot.decision.schema==='toolkit.controller-decision.v2';
  const expectedContext=executionContext||{helper:null,tools_digest:compiler.hashCanonical(toolDefinitions(role)),...(current?{reviewer_id:reviewerId}:{})};
  if(!same(value.execution_context,expectedContext))hold('HOST_ROLE_SURFACE_UNQUALIFIED');
  const binding = value.binding, decision = snapshot.decision, route = compiler.resolveControllerRole(snapshot,role,reviewerId).route;
  if (binding.kind !== 'QUALIFICATION' || binding.status !== 'QUALIFIED' || !route || route.provider !== 'openai'
    || !same(route,binding.route) || binding.role !== role || current && binding.reviewer_id!==reviewerId || binding.decision_digest !== snapshot.decision_digest
    || binding.host.cwd !== root || binding.thread !== null || binding.turn !== null || binding.dispatch_id !== null
    || Date.now() >= Date.parse(value.expires_at) || !Number.isFinite(Date.parse(value.expires_at))) hold('HOST_SURFACE_UNQUALIFIED');
  if (!path.isAbsolute(binding.executable.path) || sha(fs.readFileSync(binding.executable.path)) !== binding.executable.sha256) hold('HOST_EXECUTABLE_DRIFT');
  if (binding.instruction_digest !== compiler.hashCanonical({controller:decision.sources.controller,architecture:decision.sources.architecture})
    || binding.policy_digest !== compiler.hashCanonical({authority:decision.authority,assurance:decision.assurance})
    || binding.source_digest !== snapshot.source_observation_digest) hold('HOST_BINDING_DRIFT');
  if (!Array.isArray(value.boundaries) || value.boundaries.length !== CONFINEMENT_BOUNDARIES.length * 2) hold('HOST_SURFACE_UNQUALIFIED');
  const seen = new Set(), refs = [binding.source,value.protocol_source];
  compiler.checkCoreSchema(value.protocol_source,compiler.contractSchema('controller-decision-v1.schema.json').properties.sources.properties.controller);
  if(value.protocol_source.content_sha256!==binding.protocol.schema_digest)hold('HOST_PROTOCOL_DRIFT');
  for (const inputCase of value.boundaries) {
    const item = closed(inputCase,['boundary','kind','verdict','observed_effects','source']);
    const key = item.boundary + ':' + item.kind;
    if (!CONFINEMENT_BOUNDARIES.includes(item.boundary) || !['NEGATIVE','POSITIVE'].includes(item.kind)
      || seen.has(key) || item.verdict !== 'PASS' || !Array.isArray(item.observed_effects)) hold('HOST_SURFACE_UNQUALIFIED');
    const effects = item.observed_effects;
    if (effects.length !== 7 || effects.some(e => !Number.isSafeInteger(e) || e < 0)
      || item.kind === 'NEGATIVE' && effects.some(e => e !== 0)
      || item.kind === 'POSITIVE' && effects.reduce((a,b)=>a+b,0) !== 1) hold('HOST_SURFACE_UNQUALIFIED');
    compiler.checkCoreSchema(item.source,compiler.contractSchema('controller-decision-v1.schema.json').properties.sources.properties.controller);
    seen.add(key); refs.push(item.source);
  }
  if (new Set(refs.map(r=>r.id)).size !== refs.length) hold('HOST_SURFACE_UNQUALIFIED');
  sourceObservations(refs,value.observations);
  const digestInput = {...value,binding:{...binding}}; delete digestInput.binding.qualification_digest;
  if (binding.qualification_digest !== compiler.hashCanonical(digestInput)) hold('HOST_SURFACE_UNQUALIFIED');
  const thread = closed(value.thread_start,['model','modelProvider','cwd','approvalPolicy','sandbox','config']);
  const turn = closed(value.turn_start,['model','effort','cwd','approvalPolicy','sandboxPolicy']);
  if (thread.model !== route.model || turn.model !== route.model || turn.effort !== route.reasoning || thread.cwd !== root || turn.cwd !== root
    || thread.approvalPolicy !== 'never' || turn.approvalPolicy !== 'never' || thread.sandbox !== 'read-only'
    || thread.modelProvider !== route.provider || thread.config?.model_reasoning_effort !== route.reasoning || turn.sandboxPolicy.type !== 'readOnly'
    || !same(turn.sandboxPolicy,{type:'readOnly',access:{type:'restricted',includePlatformDefaults:false,readableRoots:[root]}})) hold('HOST_SURFACE_UNQUALIFIED');
  const resolved=closed(value.resolved_thread,['model','modelProvider','reasoningEffort','cwd','approvalPolicy','sandbox','instructionSources']);
  if(resolved.model!==route.model||resolved.modelProvider!==route.provider||resolved.reasoningEffort!==route.reasoning
    ||resolved.cwd!==root||resolved.approvalPolicy!=='never'||!same(resolved.sandbox,turn.sandboxPolicy)
    ||!Array.isArray(resolved.instructionSources)||!resolved.instructionSources.length
    ||resolved.instructionSources.some(p=>typeof p!=='string'||!path.isAbsolute(p)))hold('HOST_SURFACE_UNQUALIFIED');
  // Exact config and protocol bytes are part of the independent qualification artifact, not a guessed switch set.
  return Object.freeze(value);
}
// Server response comparison is data validation, not admission or backend attestation.
function validateResolvedThread(input,qualification,route,root) {
  const response=compiler.trustedJsonCopy(input);
  if(!response||typeof response.thread?.id!=='string'||!response.thread.id||response.model!==route.model
    ||response.modelProvider!==route.provider||response.reasoningEffort!==route.reasoning||response.cwd!==root)hold('CORE_ROUTE_BINDING_DRIFT');
  const projected={};for(const key of Object.keys(qualification.resolved_thread))projected[key]=response[key];
  if(!same(projected,qualification.resolved_thread))hold('CORE_HOST_POLICY_DRIFT');
  return Object.freeze({thread:response.thread.id,route:{provider:response.modelProvider,model:response.model,reasoning:response.reasoningEffort},policy_digest:compiler.hashCanonical(projected)});
}
function inspect(input) {
  const decision = compiler.validateControllerDecision(input);
  return Object.freeze({schema:'toolkit.core-inspection.v1',decision_digest:compiler.hashCanonical(decision),
    routes:decision.selection.routes,profile_id:decision.selection.profile_id,
    status:'DATA_ONLY_NOT_ADMITTED',native_qualification:'UNOBSERVED',candidate_allowance:0});
}
function qualifiedFile(root, relative, mode='r') {
  compiler.corePath(relative);
  if (relative.split('/').some(part=>part === '.git' || part === '.env' || part.startsWith('.env.'))) hold('CORE_PATH_FORBIDDEN');
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current,part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.nlink !== 1 && stat.isFile()) hold('CORE_PATH_ALIAS');
  }
  if (fs.realpathSync(current) !== current || !fs.statSync(current).isFile()) hold('CORE_PATH_ALIAS');
  // Unsupported native no-follow primitives hold only the file operation. No emulated permission bypass.
  if (mode !== 'r' && (!fs.constants.O_NOFOLLOW || process.platform === 'win32')) hold('CORE_NATIVE_WRITE_PRIMITIVE_UNQUALIFIED');
  const fd = fs.openSync(current, mode === 'r' ? fs.constants.O_RDONLY : fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  const opened = fs.fstatSync(fd), latest = fs.lstatSync(current);
  if (opened.dev !== latest.dev || opened.ino !== latest.ino || opened.nlink !== 1) {fs.closeSync(fd);hold('CORE_PATH_ALIAS');}
  return fd;
}
function fdBytes(fd) {
  const length=fs.fstatSync(fd).size;if(!Number.isSafeInteger(length)||length>MAX_BYTES)hold('CORE_READ_LIMIT');
  const bytes=Buffer.alloc(length);let offset=0;
  while(offset<length){const count=fs.readSync(fd,bytes,offset,length-offset,offset);if(!count)hold('CORE_READ_DRIFT');offset+=count;}
  if(fs.fstatSync(fd).size!==length)hold('CORE_READ_DRIFT');return bytes;
}
function toolDefinitions(role,helper=false) {
  const S = {type:'string',minLength:1};
  const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
  const definitions = {
    toolkit_read: object({path:S}), toolkit_search: object({path:S,literal:S}),
    toolkit_apply_patch: object({path:S,expected_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},content_base64:S}),
    toolkit_validate: object({case_id:S}), toolkit_request_helper: object({role:{enum:['DISCOVERY_HELPER','BUILDER_HELPER']},paths:{type:'array',items:S,minItems:1,uniqueItems:true},instruction:S})
  };
  const helperRole = helper || compiler.HELPER_ROLES.includes(role);
  const builderRole = role === 'BUILDER' || role === 'BUILDER_HELPER';
  const permitted = builderRole ? TOOLS.slice(0,4) : TOOLS.slice(0,2);
  if (!helperRole && (role === 'DISCOVERY' || role === 'BUILDER')) permitted.push('toolkit_request_helper');
  return permitted.map(name=>({name,description:'Bounded Toolkit '+name.slice(8)+' operation',inputSchema:definitions[name]}));
}
function toolDefinitionForRole(role,helper,name) {
  if(![...compiler.CONTINUOUS_ROLES,...compiler.HELPER_ROLES,'REVIEW'].includes(role)||!TOOLS.includes(name))hold('CORE_TOOL_FORBIDDEN');
  const definition=toolDefinitions(role,helper).find(item=>item.name===name);
  if(!definition)hold('CORE_TOOL_FORBIDDEN');return definition;
}
function validateLaunchConfig(input, helper=false) {
  if (helper && input !== null) hold('CORE_HELPER_LAUNCH_CONFIG_FORBIDDEN');
  if (input === null) return null;
  const config=compiler.trustedJsonCopy(input);
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== 1 || !Object.prototype.hasOwnProperty.call(config,'serviceTier')
    || typeof config.serviceTier !== 'string' || !config.serviceTier.length || config.serviceTier.length > 128
    || config.serviceTier !== config.serviceTier.trim() || /[\0\r\n]/.test(config.serviceTier))
    hold('CORE_LAUNCH_CONFIG_INVALID');
  return Object.freeze({serviceTier:config.serviceTier});
}
function buildNativeRequest(snapshot, qualification, role, instruction,helper=false,launchConfig=null,reviewerId=null) {
  if (typeof instruction !== 'string' || !instruction.length || Buffer.byteLength(instruction)>MAX_BYTES) hold('CORE_REQUEST_INVALID');
  const route=compiler.resolveControllerRole(snapshot,role,reviewerId).route;
  if(!route||route.provider!=='openai')hold('CORE_ROUTE_UNSUPPORTED');
  const configured=validateLaunchConfig(launchConfig,helper||compiler.HELPER_ROLES.includes(role));
  const threadStart={...qualification.thread_start,allowProviderModelFallback:false,dynamicTools:toolDefinitions(role,helper)};
  if(configured)threadStart.serviceTier=configured.serviceTier;
  return compiler.canonicalize({initialize:{clientInfo:{name:'toolkit-core',version:snapshot.decision.schema==='toolkit.controller-decision.v2'?'codex-host-adapter-v2':'codex-host-adapter-v1'},capabilities:{experimentalApi:true}},
    thread_start:threadStart,
    turn_start:{...qualification.turn_start,input:[{type:'text',text:instruction}]},
    binding:{decision_digest:snapshot.decision_digest,qualification_digest:qualification.binding.qualification_digest,role,route,...(snapshot.decision.schema==='toolkit.controller-decision.v2'?{reviewer_id:reviewerId}:{})}});
}
// Private JSON-lines protocol client. No public MCP endpoint, shell, raw CLI fallback or unqualified transport injection.
// One native protocol process owns its pending requests, turn identity and
// settlement. Construction stays private behind authentic receipt admission.
class CodexProtocolClient {
  #child; #waiting=new Map(); #next=1; #buffer=''; #ended=false;
  #activeThread=null; #activeTurn=null; #completed; #completion; #toolActive=false;
  #toolCall; #timeoutMs;
  constructor(executable,cwd,toolCall,timeoutMs) {
    this.#toolCall=toolCall; this.#timeoutMs=timeoutMs;
    this.#completion=new Promise((resolve,reject)=>{this.#completed={resolve,reject};});this.#completion.catch(()=>{});
    this.#child=spawn(executable,['app-server','--stdio'],{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.#child.on('error',()=>this.#terminate('CORE_NATIVE_START_FAILED'));
    this.#child.on('exit',()=>this.#terminate('CORE_TRANSPORT_UNRESOLVED'));
    this.#child.stderr.on('data',()=>{});
    this.#child.stdout.on('data',chunk=>this.#receive(chunk));
  }
  get completed() {return this.#completion;}
  #terminate(code) {
    if(this.#ended)return;this.#ended=true;this.#child.kill();
    for(const item of this.#waiting.values()){clearTimeout(item.timer);item.reject(Object.assign(new Error(code),{code}));}
    this.#waiting.clear();this.#completed.reject(Object.assign(new Error(code),{code}));
  }
  #send(value) {if(this.#ended)hold('CORE_TRANSPORT_CLOSED');this.#child.stdin.write(JSON.stringify(value)+'\n');}
  #receive(chunk) {
    this.#buffer+=chunk.toString('utf8');if(Buffer.byteLength(this.#buffer)>MAX_BYTES*4)return this.#terminate('CORE_PROTOCOL_LIMIT');
    let index;
    while((index=this.#buffer.indexOf('\n'))>=0){
      const line=this.#buffer.slice(0,index);this.#buffer=this.#buffer.slice(index+1);if(!line.trim())continue;
      let message;try{message=compiler.trustedJsonCopy(JSON.parse(line));}catch{this.#terminate('CORE_PROTOCOL_INVALID');return;}
      if(message.id!==undefined&&!message.method){
        const item=this.#waiting.get(message.id);if(!item){this.#terminate('CORE_PROTOCOL_INVALID');return;}
        this.#waiting.delete(message.id);clearTimeout(item.timer);
        if(message.error)item.reject(Object.assign(new Error('CORE_PROTOCOL_REJECTED'),{code:'CORE_PROTOCOL_REJECTED'}));else item.resolve(message.result);
      }else if(message.id!==undefined){
        if(this.#toolActive||message.method!=='item/tool/call'||message.params?.threadId!==this.#activeThread||message.params?.turnId!==this.#activeTurn){
          this.#send({id:message.id,error:{code:-32601,message:'Toolkit request denied'}});this.#terminate('CORE_PROTOCOL_UNQUALIFIED');return;
        }
        this.#toolActive=true;
        Promise.resolve(this.#toolCall(message.params.tool,message.params.arguments)).then(result=>this.#send({id:message.id,result:{contentItems:[{type:'inputText',text:JSON.stringify(result)}],success:true}})).catch(error=>{
          if(!this.#ended)this.#send({id:message.id,result:{contentItems:[{type:'inputText',text:'Toolkit action held. Reference: '+(error.code||'CORE_ACTION_HELD')}],success:false}});
        }).finally(()=>{this.#toolActive=false;});
      }else if(message.method==='model/rerouted'){this.#terminate('CORE_ROUTE_REROUTED');return;}
      else if(message.method==='turn/completed'){
        if(this.#toolActive||message.params?.threadId!==this.#activeThread||message.params?.turn?.id!==this.#activeTurn){this.#terminate('CORE_PROTOCOL_INVALID');return;}
        this.#completed.resolve({thread:this.#activeThread,turn:this.#activeTurn,status:message.params.turn.status});
      }else if(message.method==='item/started'){
        const type=message.params?.item?.type;
        if(type&&!['agentMessage','userMessage','reasoning','dynamicToolCall','plan'].includes(type)){this.#terminate('CORE_UNQUALIFIED_NATIVE_EFFECT');return;}
      }
    }
  }
  request(method,params) {
    if(this.#ended)return Promise.reject(Object.assign(new Error('CORE_TRANSPORT_CLOSED'),{code:'CORE_TRANSPORT_CLOSED'}));
    const id=this.#next++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.#waiting.delete(id);reject(Object.assign(new Error('CORE_PROTOCOL_TIMEOUT'),{code:'CORE_PROTOCOL_TIMEOUT'}));this.#terminate('CORE_TRANSPORT_UNRESOLVED');},this.#timeoutMs);
      this.#waiting.set(id,{resolve,reject,timer});this.#send({id,method,params});
    });
  }
  notify(method,params) {this.#send({method,params});}
  bind(thread,turn) {this.#activeThread=thread;this.#activeTurn=turn;}
  close() {this.#terminate('CORE_TRANSPORT_CLOSED');}
}
function nativeClient(executable,cwd,toolCall,timeoutMs) {return new CodexProtocolClient(executable,cwd,toolCall,timeoutMs);}
function createCodexAdapter(channel, root, helperCapability=null, launchConfig=null) {
  receipts.assertAuthenticControllerEffectChannel(channel);
  if(typeof root!=='string'||!path.isAbsolute(root)||fs.realpathSync(root)!==path.resolve(root)||fs.lstatSync(root).isSymbolicLink())hold('CORE_ROOT_UNQUALIFIED');
  root=path.resolve(root);
  const helper=helperCapability===null?null:HELPERS.get(helperCapability);
  if(helperCapability!==null&&(!helper||helper.channel!==channel||helper.root!==root))hold('CORE_HELPER_BINDING_INVALID');
  const configuredLaunch=validateLaunchConfig(launchConfig,Boolean(helper));
  const constructionToken=Symbol('native-codex-adapter-construction');
  class NativeCodexAdapter {
    #owner;
    constructor(token,dependencies){
      if(token!==constructionToken)hold('CORE_AUTHENTIC_ADAPTER_REQUIRED');
      this.#owner=dependencies;
      for(const name of Object.getOwnPropertyNames(Object.getPrototypeOf(this)))if(name!=='constructor'){
        const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this),name);
        Object.defineProperty(this,name,{...descriptor,enumerable:true});
      }
      Object.freeze(this);
      ADAPTERS.set(this,this.#owner);
    }
    inspect() {const owner=state(this);return inspect(owner.channel.snapshot().decision);}
    qualify(role,reviewerId=null) {
      const owner=state(this), snapshot=owner.channel.snapshot();
      // No qualification turn is issued here. Missing installed proof remains a typed dependent HOLD.
      const context={...(snapshot.decision.schema==='toolkit.controller-decision.v2'?{reviewer_id:reviewerId}:{}),helper:owner.helper?{depth:1,paths:owner.helper.paths,parent_thread:owner.helper.parent_thread,parent_turn:owner.helper.parent_turn}:null,tools_digest:compiler.hashCanonical(toolDefinitions(role,Boolean(owner.helper)))};
      return validateHostQualification(owner.channel.qualification(role,context,reviewerId),snapshot,role,owner.root,context,reviewerId);
    }
    async tool(name,input) {
      const owner=state(this), snapshot=owner.channel.snapshot(),d=snapshot.decision;
      const definition=toolDefinitionForRole(owner.role,Boolean(owner.helper),name);const value=compiler.trustedJsonCopy(input);
      compiler.checkCoreSchema(value,definition.inputSchema);
      if(value.path && (!d.authority.targets.includes(value.path)||!d.construction.allow_paths.includes(value.path)||owner.helper&&!owner.helper.paths.includes(value.path)))hold('CORE_PATH_FORBIDDEN');
      if(name==='toolkit_read'||name==='toolkit_search') {
        const fd=qualifiedFile(owner.root,value.path);let bytes;try{bytes=fdBytes(fd);}finally{fs.closeSync(fd);}
        if(bytes.length>MAX_BYTES)hold('CORE_READ_LIMIT');
        const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))hold('CORE_TEXT_REQUIRED');
        if(name==='toolkit_read')return {path:value.path,sha256:sha(bytes),text};
        if(value.literal.length>512)hold('CORE_SEARCH_LIMIT');
        const matches=text.split(/\r?\n/).flatMap((line,i)=>line.includes(value.literal)?[{line:i+1,text:line}]:[]);
        if(matches.length>256)hold('CORE_SEARCH_LIMIT');return {path:value.path,sha256:sha(bytes),matches};
      }
      if(name==='toolkit_request_helper') {
        const helperRole=owner.role==='DISCOVERY'?'DISCOVERY_HELPER':owner.role==='BUILDER'?'BUILDER_HELPER':null;
        if(owner.helper||!helperRole||value.role!==helperRole||owner.helperActive||!owner.thread||!owner.turn
          ||value.paths.some(p=>!d.authority.targets.includes(p)||!d.construction.allow_paths.includes(p)))hold('CORE_HELPER_FORBIDDEN');
        if(snapshot.counts.HELPER>=Math.min(d.selection.helper_bound,d.authority.effect_ceiling.helper_launches,d.accounting.remaining.helpers))hold('CORE_HELPER_EXHAUSTED');
        await verifyNativeHelperRegistration(owner.client, owner.root);
        if (owner.channel.snapshot().decision_digest !== snapshot.decision_digest) hold('CORE_NATIVE_HELPER_AUTHORITY_DRIFT');
        if (owner.helperActive || !owner.thread || !owner.turn) hold('CORE_HELPER_FORBIDDEN');
        // Existing resource admission must independently prove suspended parent ownership and a disjoint depth-one assignment.
        const capability=Object.freeze({});HELPERS.set(capability,{channel:owner.channel,root:owner.root,paths:Object.freeze([...value.paths]),role:value.role,parent_thread:owner.thread,parent_turn:owner.turn});
        owner.helperActive=true;
        try{return await createCodexAdapter(owner.channel,owner.root,capability).run(value.role,value.instruction);}
        finally{owner.helperActive=false;HELPERS.delete(capability);}
      }
      if(name==='toolkit_apply_patch') {
        const bytes=Buffer.from(value.content_base64,'base64');if(bytes.toString('base64')!==value.content_base64||bytes.length>MAX_BYTES)hold('CORE_PATCH_INVALID');
        const fd=qualifiedFile(owner.root,value.path,'rw');
        try {
          const before=fdBytes(fd);if(sha(before)!==value.expected_sha256)hold('CORE_PREIMAGE_DRIFT');
          const request={kind:'PATCH',role:null,effect:value,id:compiler.hashCanonical({path:value.path,expected_sha256:value.expected_sha256}),request_digest:compiler.hashCanonical(value),expected_post_state_digest:sha(bytes)};
          const admission=await owner.channel.prepare(request);
          let error;try {
            if(sha(fdBytes(fd))!==value.expected_sha256)hold('CORE_PREIMAGE_DRIFT');
            let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)hold('CORE_PATCH_WRITE_FAILED');offset+=n;}
            fs.ftruncateSync(fd,bytes.length);fs.fsyncSync(fd);if(sha(fdBytes(fd))!==sha(bytes))hold('CORE_PATCH_READBACK_FAILED');
          } catch(cause){error=cause;}
          const outcome=await owner.channel.finish(admission);if(error)throw error;
          if(outcome.state!=='APPLIED')hold('CORE_EFFECT_UNRESOLVED');return {path:value.path,sha256:sha(bytes),operation_id:admission.operation_id};
        } finally {fs.closeSync(fd);}
      }
      const item=d.verification.cases.find(c=>c.id===value.case_id);if(!item)hold('CORE_VALIDATION_UNLISTED');
      if(item.runner.cwd!==owner.root||!path.isAbsolute(item.runner.executable)||item.runner.argv.some(a=>typeof a!=='string'))hold('CORE_VALIDATION_ROOT_UNQUALIFIED');
      // A validation effect requires the qualified host envelope for this exact case and output roots.
      const resources=closed(owner.channel.resources({kind:'VALIDATE',case_id:item.id}),['status','source_digest','output_roots','executable_sha256','timeout_ms']);
      if(resources.status!=='ADMITTED'||!same(resources.output_roots,item.output_paths)||resources.timeout_ms!==item.timeout_ms
        ||sha(fs.readFileSync(item.runner.executable))!==resources.executable_sha256)hold('CORE_RESOURCE_UNQUALIFIED');
      if (!resources.output_roots.length) hold('CORE_VALIDATION_ROOT_UNQUALIFIED');
      const outputRoots=resources.output_roots.map(relative=>{
        compiler.corePath(relative);const absolute=path.resolve(owner.root,relative);
        if(fs.realpathSync(absolute)!==absolute||!fs.lstatSync(absolute).isDirectory())hold('CORE_VALIDATION_ROOT_UNQUALIFIED');return absolute;
      });
      const prior=snapshot.operations.filter(o=>o.operation.target_identity.resource_id.includes(':VALIDATE:')&&o.operation.adapter_identity_digest===compiler.hashCanonical({runner:item.runner,max_invocations:item.max_invocations,timeout_ms:item.timeout_ms,output_paths:item.output_paths,source:item.source}));
      if(prior.length>=item.max_invocations)hold('CORE_VALIDATION_EXHAUSTED');
      const admission=await owner.channel.prepare({kind:'VALIDATE',role:null,effect:{case_id:item.id,command:{runner:item.runner,max_invocations:item.max_invocations,timeout_ms:item.timeout_ms,output_paths:item.output_paths,source:item.source}},id:compiler.hashCanonical({command_id:item.runner.id,invocation:prior.length+1}),request_digest:compiler.hashCanonical({runner:item.runner,max_invocations:item.max_invocations,timeout_ms:item.timeout_ms,output_paths:item.output_paths,source:item.source}),expected_post_state_digest:null});
      const result=spawnSync(item.runner.executable,item.runner.argv,{cwd:owner.root,shell:false,windowsHide:true,timeout:item.timeout_ms,maxBuffer:MAX_BYTES,
        env:{PATH:path.dirname(item.runner.executable),TEMP:outputRoots[0],TMP:outputRoots[0],TMPDIR:outputRoots[0]}});
      const outcome=await owner.channel.finish(admission);if(outcome.state!=='APPLIED'||result.error||result.status!==0)hold('CORE_VALIDATION_FAILED');
      return {case_id:item.id,exit:result.status,stdout_sha256:sha(result.stdout||Buffer.alloc(0)),stderr_sha256:sha(result.stderr||Buffer.alloc(0)),operation_id:admission.operation_id};
    }
    async run(role,instruction,reviewerId=null) {
      const owner=state(this);if(owner.active)hold('CORE_TURN_ALREADY_ACTIVE');
      const snapshot=owner.channel.snapshot();
      const routeRoles=[...compiler.CONTINUOUS_ROLES,...compiler.HELPER_ROLES];
      const route=compiler.resolveControllerRole(snapshot,role,reviewerId).route;
      if(!routeRoles.includes(role)||!route||route.provider!=='openai')hold('CORE_ROUTE_UNSUPPORTED');
      const stage=snapshot.consumer.stage;
      const permitted={G0:['DISCOVERY'],G1:['BUILDER'],G2:snapshot.decision.schema==='toolkit.controller-decision.v2'?['REVIEW']:['REVIEW_SCOPE','REVIEW_EXECUTION']}[stage]||[];
      if(role==='DESIGN_CHALLENGE'&&snapshot.decision.assurance.design_challenge_required&&['G0','G1'].includes(stage))permitted.push('DESIGN_CHALLENGE');
      if(owner.helper) {
        const helperRole=stage==='G0'?'DISCOVERY_HELPER':stage==='G1'?'BUILDER_HELPER':null;
        if(role!==owner.helper.role||role!==helperRole)hold('CORE_HELPER_FORBIDDEN');
      } else if(!compiler.CONTINUOUS_ROLES.includes(role)||!permitted.includes(role)) hold('CORE_STAGE_ROLE_FORBIDDEN');
      const qualification=this.qualify(role,reviewerId), request=buildNativeRequest(snapshot,qualification,role,instruction,Boolean(owner.helper),owner.launchConfig,reviewerId);
      const resources=closed(owner.channel.resources({kind:owner.helper?'HELPER':'NATIVE',role,...(role==='REVIEW'?{reviewer_id:reviewerId}:{}),helper:owner.helper?{paths:owner.helper.paths,parent_thread:owner.helper.parent_thread,parent_turn:owner.helper.parent_turn,depth:1}:null,request_digest:compiler.hashCanonical(request)}),['status','source_digest','timeout_ms']);
      if(!/^[a-f0-9]{64}$/.test(resources.source_digest)||resources.status!=='ADMITTED'||!Number.isSafeInteger(resources.timeout_ms)||resources.timeout_ms<1)hold('CORE_RESOURCE_UNQUALIFIED');
      const kind=owner.helper?'HELPER':'NATIVE';
      const admission=await owner.channel.prepare({kind,role,...(role==='REVIEW'?{reviewer_id:reviewerId}:{}),effect:{request,helper:owner.helper?{paths:owner.helper.paths,parent_thread:owner.helper.parent_thread,parent_turn:owner.helper.parent_turn,depth:1}:null},id:compiler.hashCanonical({role,...(role==='REVIEW'?{reviewer_id:reviewerId}:{}),instruction_digest:sha(Buffer.from(instruction)),invocation:snapshot.counts[kind]+1}),request_digest:compiler.hashCanonical(request),expected_post_state_digest:null});
      owner.role=role;owner.active=true;
      const client=nativeClient(qualification.binding.executable.path,owner.root,(tool,args)=>this.tool(tool,args),resources.timeout_ms);owner.client=client;
      let observed,error,launchOutcome;
      try {
        await client.request('initialize',request.initialize);client.notify('initialized',{});
        const models=await client.request('model/list',{});
        if(!Array.isArray(models.data)||!models.data.some(model=>model.id===request.binding.route.model
          &&Array.isArray(model.supportedReasoningEfforts)&&model.supportedReasoningEfforts.some(e=>e.reasoningEffort===request.binding.route.reasoning)))hold('CORE_ROUTE_UNSUPPORTED');
        const thread=await client.request('thread/start',request.thread_start);
        validateResolvedThread(thread,qualification,request.binding.route,owner.root);
        owner.channel.revalidateLaunch(admission.operation_id);
        client.bind(thread.thread.id,null);
        const turn=await client.request('turn/start',{...request.turn_start,threadId:thread.thread.id});if(typeof turn.turn?.id!=='string')hold('CORE_PROTOCOL_INVALID');
        client.bind(thread.thread.id,turn.turn.id);owner.thread=thread.thread.id;owner.turn=turn.turn.id;
        // APPEND_CREATE denotes the one launch, not a lock spanning every nested tool effect.
        // Its independent turn-start readback settles that intent before a patch/validation intent can be admitted.
        launchOutcome=await owner.channel.finish(admission);
        if(launchOutcome.state!=='APPLIED')hold('CORE_TURN_START_UNRESOLVED');
        const timeout=setTimeout(()=>client.close(),resources.timeout_ms);try{observed=await client.completed;}finally{clearTimeout(timeout);}
        const readback=await client.request('thread/read',{threadId:owner.thread,includeTurns:false});
        if(readback.thread?.id!==owner.thread)hold('CORE_THREAD_READBACK_DRIFT');
      }catch(cause){error=cause;}finally{client.close();owner.active=false;owner.role=null;owner.client=null;}
      if(!launchOutcome)launchOutcome=await owner.channel.finish(admission);
      if(error)throw error;
      const independent=closed(owner.channel.observeTurn(admission.operation_id),['status','thread','turn','decision_digest','operation_id','effects_digest','source']);
      if(launchOutcome.state!=='APPLIED'||observed.status!=='completed'||independent.status!=='COMPLETED'
        ||independent.thread!==observed.thread||independent.turn!==observed.turn||independent.decision_digest!==snapshot.decision_digest
        ||independent.operation_id!==admission.operation_id||!/^[a-f0-9]{64}$/.test(independent.effects_digest))hold('CORE_TURN_EFFECTS_UNRESOLVED');
      return {schema:'toolkit.codex-turn-receipt.v1',...observed,operation_id:admission.operation_id,decision_digest:snapshot.decision_digest,qualification_digest:qualification.binding.qualification_digest,...(snapshot.decision.schema==='toolkit.controller-decision.v2'?{role,reviewer_id:reviewerId,route}:{}),semantic_completion:'REQUIRES_OUTPUT_PACKET_CONFIRMATION',completion_applicability:owner.channel.completionApplicability()};
    }
    async interrupt() {
      const owner=state(this);if(!owner.active||!owner.client||!owner.thread||!owner.turn)hold('CORE_NO_KNOWN_TURN');
      await owner.client.request('turn/interrupt',{threadId:owner.thread,turnId:owner.turn});
      return {status:'INTERRUPTION_REQUESTED_REQUIRES_INDEPENDENT_READBACK'};
    }
    recover() {const owner=state(this);return owner.channel.recover();}
  }
  Object.freeze(NativeCodexAdapter.prototype);
  const adapter=new NativeCodexAdapter(constructionToken,{channel,root,process:process.pid,active:false,role:null,thread:null,turn:null,client:null,helper,helperActive:false,launchConfig:configuredLaunch});
  return adapter;
}
module.exports=Object.freeze({assertAuthenticCodexAdapter: adapter => { state(adapter); return true; },inspect,validateHostQualification,validateResolvedThread,buildNativeRequest,toolDefinitions,toolDefinitionForRole,createCodexAdapter,verifyNativeHelperRegistration,CONFINEMENT_BOUNDARIES});
