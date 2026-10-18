'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { createNativeHelperAdapter } = require('./toolkit-v3-native-helper-adapter.cjs');
const { validateTaskSessionProfile, receiptPath } = require('./toolkit-claude-task-session.cjs');
const hash = value => compiler.hashCanonical(value);
function fail(code) { throw Object.assign(new Error(code), { code }); }
async function boundedNativeCall(operation, input, limit) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(()=>operation(input)),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('CLAUDE_NATIVE_CONTROL_TIMEOUT'),{code:'CLAUDE_NATIVE_CONTROL_TIMEOUT'})),limit);})]); }
  finally { clearTimeout(timer); }
}
function bounds(raw) {
  const value = compiler.trustedJsonCopy(raw);
  const keys = ['state','disposition_id','counter_reference','resource_admission_reference','parent_invocation_bound_reference','max_inflight_helpers','max_helper_dispatches',
    'existing_helper_consumption','per_invocation_timeout_ms','aggregate_timeout_ms','native_control_verified','route_immutable_after_boundary'];
  if (!value || Object.keys(value).sort().join('|') !== keys.sort().join('|') || value.state !== 'ROOT_ADMITTED'
    || !value.disposition_id || !/^[a-f0-9]{64}$/.test(value.counter_reference || '')
    || !/^[a-f0-9]{64}$/.test(value.resource_admission_reference || '')
    || !/^[a-f0-9]{64}$/.test(value.parent_invocation_bound_reference || '')
    || value.max_inflight_helpers !== 1 || !Number.isSafeInteger(value.max_helper_dispatches) || value.max_helper_dispatches < 1
    || !Number.isSafeInteger(value.existing_helper_consumption) || value.existing_helper_consumption < 0
    || !Number.isSafeInteger(value.per_invocation_timeout_ms) || value.per_invocation_timeout_ms < 1
    || !Number.isSafeInteger(value.aggregate_timeout_ms) || value.aggregate_timeout_ms < value.per_invocation_timeout_ms
    || value.native_control_verified !== true || value.route_immutable_after_boundary !== true) fail('CLAUDE_ROOT_DISPOSITION_REQUIRED');
  return value;
}
function createDispatchObserver({ write_observation }) {
  if (typeof write_observation !== 'function') fail('CLAUDE_INDEPENDENT_OBSERVER_REQUIRED');
  const write = write_observation;
  return Object.freeze({ record(type, raw) {
    const data = compiler.trustedJsonCopy(raw);
    if (!['FINAL_PERMISSION_BOUNDARY','CREATION_OBSERVED','MODEL_REQUEST_OBSERVED','TASK_EFFECT_OBSERVED','TERMINAL_OBSERVED','DEADLINE_INTERRUPTION'].includes(type)) fail('CLAUDE_OBSERVER_EVENT_INVALID');
    const observation = { schema: 'toolkit.v3.claude-independent-dispatch-observation.v1', type, ...data };
    write(Object.freeze(observation));return observation;
  } });
}
class ClaudeParentDispatchGate {
  #profile; #readHost; #readBounds; #observer; #interrupt; #settlement; #now;
  #ledgerFile; #lockFile; #timers=new Map();
  constructor({ profile, observe_host_state, read_root_disposition, observer,
  interrupt_native, read_native_settlement, now = Date.now, authority_pins = {} }) {
  const p = validateTaskSessionProfile(profile, authority_pins), readHost = observe_host_state, readBounds = read_root_disposition;
  if (typeof readHost !== 'function' || typeof readBounds !== 'function' || !observer || typeof observer.record !== 'function') fail('CLAUDE_DISPATCH_BINDING_REQUIRED');
  const ledgerFile = path.join(p.control_root, 'dispatch-ledger.json'), lockFile = ledgerFile + '.lock';
  this.#profile=p;this.#readHost=readHost;this.#readBounds=readBounds;this.#observer=observer;
  this.#interrupt=interrupt_native;this.#settlement=read_native_settlement;this.#now=now;
  this.#ledgerFile=ledgerFile;this.#lockFile=lockFile;
  fs.mkdirSync(p.control_root, { recursive: true });
  Object.defineProperties(this,{
    canUseTool:{value:this.#canUseTool.bind(this),enumerable:true},observeLifecycle:{value:this.#observeLifecycle.bind(this),enumerable:true},
    enforceDeadline:{value:this.#enforceDeadline.bind(this),enumerable:true},inspect:{value:this.#inspect.bind(this),enumerable:true},
    handleControlRequest:{value:this.#handleControlRequest.bind(this),enumerable:true}});
  Object.freeze(this);
  }
  #locked(operation) {
    const lockFile=this.#lockFile;
    let fd;try { fd = fs.openSync(lockFile, 'wx', 0o600); } catch (_) { fail('CLAUDE_DISPATCH_GATE_BUSY'); }
    try { return operation(); } finally { fs.closeSync(fd);fs.unlinkSync(lockFile); }
  }
  #load(b) {
    const ledgerFile=this.#ledgerFile,now=this.#now;
    const { existing_helper_consumption, ...fixed } = b;
    const identity = hash(fixed);
    if (!fs.existsSync(ledgerFile)) return { schema: 'toolkit.v3.claude-external-qualification-ledger.v1',
      disposition_digest: identity, counter_reference: b.counter_reference,
      consumed: b.existing_helper_consumption, started_ms: now(), active: null, attempts: [] };
    const stat = fs.lstatSync(ledgerFile);if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('CLAUDE_LEDGER_ALIAS');
    const value = JSON.parse(fs.readFileSync(ledgerFile));
    if (value.disposition_digest !== identity || value.counter_reference !== b.counter_reference) fail('CLAUDE_DISPOSITION_OR_COUNTER_DRIFT');
    value.consumed = Math.max(value.consumed, b.existing_helper_consumption);
    return value;
  }
  #save(value) {
    const ledgerFile=this.#ledgerFile;
    const temp = ledgerFile + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });fs.renameSync(temp, ledgerFile);
  }
  async #canUseTool(toolName, rawInput, metadata) {
    const p=this.#profile,readHost=this.#readHost,readBounds=this.#readBounds,observer=this.#observer,
      interrupt_native=this.#interrupt,read_native_settlement=this.#settlement,now=this.#now,timers=this.#timers;
    let entered = false;
    try {
      const input = compiler.trustedJsonCopy(rawInput), info = compiler.trustedJsonCopy(metadata);
      if (!['Agent','Task'].includes(toolName) || info.session_id !== p.session_id || info.agent_id || info.agent_type) fail('CLAUDE_FINAL_CALLER_OR_ENTRY_MISMATCH');
      const receipt = JSON.parse(fs.readFileSync(receiptPath(p, info.tool_use_id)));
      const exact = receipt.profile_digest === hash(p) && receipt.session_id === p.session_id
        && receipt.tool_use_id === info.tool_use_id && receipt.tool_name === toolName && receipt.input_digest === hash(input);
      entered = true;observer.record('FINAL_PERMISSION_BOUNDARY', { tool_use_id: info.tool_use_id, tool_name: toolName,
        profile_digest: hash(p), input_digest: hash(input), primary_receipt_exact: exact,
        guard_escape: !exact || receipt.decision !== 'ROUTE_PRECHECK_PASSED', child_created: false,
        first_model_request: 'NOT_OBSERVED', task_effects: 'NOT_OBSERVED' });
      if (!exact || receipt.decision !== 'ROUTE_PRECHECK_PASSED') fail('CLAUDE_GUARD_ESCAPE_OR_PRECHECK_DRIFT');
      if (p.qualification_override) fail('CLAUDE_PARENT_ONLY_HELPER_EXECUTION_PROHIBITED');
      if (toolName === 'Task') fail('CLAUDE_TASK_ALIAS_NATIVE_QUALIFICATION_REQUIRED');
      let preparation;
      const adapter = createNativeHelperAdapter({ entry_id: 'claude_parent_agent', helper_identity: p.helper_identity, source_capture: p.source_capture, selection: p.selection,
        session_id: p.session_id, cwd: p.cwd, observe_host_state: readHost,
        dispatch_native: value => { preparation = value;return { inference_dispatched: false, stage: 'FINAL_PARENT_PERMISSION' }; } });
      const route = await adapter.invoke({ hook_event_name: 'PreToolUse',tool_name: 'Agent',session_id: p.session_id,
        cwd: p.cwd,tool_input: input });
      if (route.decision !== 'ALLOW' || !preparation) fail('CLAUDE_FINAL_ROUTE_RECHECK_FAILED');
      const admitted = bounds(await readBounds());
      if (typeof interrupt_native !== 'function' || typeof read_native_settlement !== 'function') fail('CLAUDE_DEADLINE_AND_SETTLEMENT_BINDING_REQUIRED');
      const attempt = this.#locked(() => {
        const state = this.#load(admitted);
        if (state.attempts.some(x => x.tool_use_id === info.tool_use_id)) fail('CLAUDE_NATIVE_REQUEST_REPLAY');
        if (state.active) fail('CLAUDE_ONE_HELPER_ALREADY_INFLIGHT');
        if (state.consumed >= admitted.max_helper_dispatches) fail('CLAUDE_HELPER_CONSUMPTION_EXHAUSTED');
        if (now() - state.started_ms >= admitted.aggregate_timeout_ms) fail('CLAUDE_AGGREGATE_BOUND_EXHAUSTED');
        const item = { id: crypto.randomUUID(),tool_use_id: info.tool_use_id,session_id: p.session_id,
          input_digest: hash(input),route_digest: hash(preparation.route),started_ms: now(),
          deadline_ms: now() + admitted.per_invocation_timeout_ms,state: 'PERMISSION_ALLOW_INTENT',child_id: null };
        state.consumed++;state.active = item.id;state.attempts.push(item);this.#save(state);return item;
      });
      const timer = setTimeout(() => { this.#enforceDeadline(attempt.id).catch(error => {
        observer.record('DEADLINE_INTERRUPTION',{attempt_id:attempt.id,state:'HOLD_UNRESOLVED',code:error.code||'CLAUDE_INTERRUPT_UNRESOLVED',consumption_refunded:false});
      }); }, admitted.per_invocation_timeout_ms);
      timer.unref();timers.set(attempt.id, timer);
      return { behavior: 'allow',updatedInput: input,toolkit_attempt_id: attempt.id,
        qualification: 'UNQUALIFIED_UNTIL_NATIVE_MATRIX',resource_control: 'EXTERNAL_SERIAL_FINITE_ROOT_DISPOSITION' };
    } catch (error) {
      if (!entered) observer.record('FINAL_PERMISSION_BOUNDARY', { tool_name: toolName,
        guard_escape: true,precheck_unavailable: true,child_created: false,first_model_request: 'NOT_OBSERVED',task_effects: 'NOT_OBSERVED' });
      return { behavior: 'deny',message: 'Toolkit native helper held: ' + (error.code || 'CLAUDE_FINAL_DISPATCH_ERROR'),
        interrupt: false,qualification: 'UNQUALIFIED',child_creation: 'NOT_AUTHORISED' };
    }
  }
  #observeLifecycle(type, raw) {
    const ledgerFile=this.#ledgerFile,observer=this.#observer,timers=this.#timers;
    const event = compiler.trustedJsonCopy(raw);
    if (!['CREATION_OBSERVED','MODEL_REQUEST_OBSERVED','TASK_EFFECT_OBSERVED','TERMINAL_OBSERVED'].includes(type)) fail('CLAUDE_LIFECYCLE_EVENT_INVALID');
    this.#locked(() => {
      if (!fs.existsSync(ledgerFile)) fail('CLAUDE_LIFECYCLE_WITHOUT_ADMISSION');
      const state = JSON.parse(fs.readFileSync(ledgerFile)),attempt = state.attempts.find(x => x.id === event.attempt_id);
      if (!attempt || state.active !== attempt.id) fail('CLAUDE_LIFECYCLE_ATTEMPT_MISMATCH');
      if (type === 'CREATION_OBSERVED') { if (!event.child_id || attempt.child_id) fail('CLAUDE_CHILD_IDENTITY_DRIFT');attempt.child_id=event.child_id;attempt.state='CHILD_OBSERVED'; }
      if (type === 'MODEL_REQUEST_OBSERVED' && (event.child_id !== attempt.child_id || event.route_digest !== attempt.route_digest)) {
        observer.record(type,{...event,guard_escape:true,qualification:'FAILED_ROUTE_ESCAPED_TO_OBSERVER'});
        fail('CLAUDE_OBSERVED_MODEL_ROUTE_MISMATCH');
      }
      if (type === 'TERMINAL_OBSERVED') {
        if (!event.child_id || event.child_id !== attempt.child_id || event.descendants_settled !== true) fail('CLAUDE_NATIVE_SETTLEMENT_REQUIRED');
        attempt.state='TERMINAL_OBSERVED';state.active=null;
        clearTimeout(timers.get(attempt.id));timers.delete(attempt.id);
      }
      this.#save(state);
    });return observer.record(type, event);
  }
  async #enforceDeadline(attemptId) {
    const ledgerFile=this.#ledgerFile,now=this.#now,observer=this.#observer,
      interrupt_native=this.#interrupt,read_native_settlement=this.#settlement;
    const request = this.#locked(() => {
      if (!fs.existsSync(ledgerFile)) fail('CLAUDE_DEADLINE_WITHOUT_ADMISSION');
      const state=JSON.parse(fs.readFileSync(ledgerFile)),attempt=state.attempts.find(x=>x.id===attemptId);
      if(!attempt||state.active!==attemptId)fail('CLAUDE_DEADLINE_ATTEMPT_MISMATCH');
      if(now()<attempt.deadline_ms)fail('CLAUDE_DEADLINE_NOT_EXPIRED');
      if(attempt.state==='INTERRUPT_INTENT')fail('CLAUDE_INTERRUPT_OUTCOME_UNKNOWN_NO_REPLAY');
      attempt.state='INTERRUPT_INTENT';this.#save(state);return compiler.trustedJsonCopy(attempt);
    });
    observer.record('DEADLINE_INTERRUPTION',{attempt_id:request.id,state:'INTERRUPT_INTENT',consumption_refunded:false});
    const limit=request.deadline_ms-request.started_ms;
    await boundedNativeCall(interrupt_native,Object.freeze({attempt_id:request.id,session_id:request.session_id,child_id:request.child_id}),limit);
    const settled=compiler.trustedJsonCopy(await boundedNativeCall(read_native_settlement,request,limit));
    if(settled.attempt_id!==request.id||settled.child_id!==request.child_id||settled.descendants_settled!==true
      ||!request.child_id)fail('CLAUDE_DEADLINE_SETTLEMENT_UNPROVEN');
    return this.#observeLifecycle('TERMINAL_OBSERVED',settled);
  }
  #inspect() { const ledgerFile=this.#ledgerFile;return fs.existsSync(ledgerFile) ? compiler.trustedJsonCopy(JSON.parse(fs.readFileSync(ledgerFile))) : { state: 'NO_HELPER_DISPATCH_ADMITTED' }; }
  #handleControlRequest(message) {
    const p=this.#profile,value=compiler.trustedJsonCopy(message);
    if(value.type!=='control_request'||value.request?.subtype!=='can_use_tool')fail('CLAUDE_CONTROL_REQUEST_UNSUPPORTED');
    return this.#canUseTool(value.request.tool_name,value.request.input,{session_id:p.session_id,
      tool_use_id:value.request.tool_use_id,
      ...(value.request.agent_id===undefined?{}:{agent_id:value.request.agent_id}),
      ...(value.request.agent_type===undefined?{}:{agent_type:value.request.agent_type})});
  }
}
Object.freeze(ClaudeParentDispatchGate.prototype);
function createParentDispatchGate(options) {return new ClaudeParentDispatchGate(options);}

function createSdkHostControlHandler({ gate, send_control_response }) {
  if(!gate||typeof gate.handleControlRequest!=='function'||typeof send_control_response!=='function')fail('CLAUDE_SDK_CONTROL_BINDING_REQUIRED');
  const send=send_control_response;
  return async raw => {
    const message=compiler.trustedJsonCopy(raw);
    if(message.type!=='control_request'||typeof message.request_id!=='string'||!message.request_id)fail('CLAUDE_SDK_CONTROL_MESSAGE_INVALID');
    let answer;
    try {
      const result=await gate.handleControlRequest(message);
      answer=result.behavior==='allow'?{behavior:'allow',updatedInput:result.updatedInput}
        :{behavior:'deny',message:result.message,interrupt:false};
    }catch(error){answer={behavior:'deny',message:'Toolkit control held: '+(error.code||'CLAUDE_CONTROL_ERROR'),interrupt:false};}
    const response={type:'control_response',response:{subtype:'success',request_id:message.request_id,response:answer}};
    await send(Object.freeze(response));return response;
  };
}
module.exports = Object.freeze({ createDispatchObserver,createParentDispatchGate,createSdkHostControlHandler });
