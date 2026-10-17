'use strict';
const { createNativeHelperAdapter, pinnedBindingObserver } = require('./toolkit-v3-native-helper-adapter.cjs');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
function freezeNativeJson(value) {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freezeNativeJson(child);Object.freeze(value);}
  return value;
}

// Explicit API selection: V1 and V2 registrations never share extension schemas.
class OpenCodeHelperBoundary {
  #generation; #read; #observeSession; #observeAgent; #timeoutMs; #parameterChecks=new Map();
  constructor({ generation, binding_path, binding_sha256, observe_session, observe_agent, timeout_ms = 150 }) {
  if (!['V1','V2'].includes(generation)) throw new Error('OPENCODE_API_GENERATION_REQUIRED');
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 10000) throw new Error('OPENCODE_OBSERVER_TIMEOUT_INVALID');
  this.#generation=generation;this.#read=()=>pinnedBindingObserver(binding_path,binding_sha256)();
  this.#observeSession=observe_session;this.#observeAgent=observe_agent;this.#timeoutMs=timeout_ms;
  Object.defineProperties(this,{check:{value:this.#check.bind(this),enumerable:true},finalParameters:{value:this.#finalParameters.bind(this),enumerable:true},finalHeaders:{value:this.#finalHeaders.bind(this),enumerable:true}});
  Object.freeze(this);
  }
  async #observedAgent(id) {
    if(typeof this.#observeAgent!=='function')throw new Error('OPENCODE_AGENT_OBSERVER_UNAVAILABLE');let timer;
    try{return await Promise.race([Promise.resolve().then(()=>this.#observeAgent(id)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OPENCODE_AGENT_OBSERVATION_TIMEOUT')),this.#timeoutMs);})]);}finally{clearTimeout(timer);}
  }
  #snapshot(input) {return compiler.trustedJsonCopy({sessionID:input.sessionID,agent:input.agent,
    model:{providerID:input.model?.providerID,id:input.model?.id,apiID:input.model?.api?.id}});}
  async #observedSession(id) {
    const observe_session=this.#observeSession,timeout_ms=this.#timeoutMs;
    if (typeof observe_session !== 'function') throw new Error('OPENCODE_SESSION_OBSERVER_UNAVAILABLE');
    let timer;
    try { return await Promise.race([Promise.resolve().then(() => observe_session(id)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OPENCODE_SESSION_OBSERVATION_TIMEOUT')), timeout_ms); })]); }
    finally { clearTimeout(timer); }
  }
  async #check(input, output) {
    const generation=this.#generation,read=this.#read;
    const expectedTool = generation === 'V1' ? 'task' : 'subagent';
    if (input.tool !== expectedTool) return;
    const binding = read();
    if (binding.schema !== 'toolkit.v3.native-helper-binding.v1' || binding.api_generation !== generation) throw new Error('OPENCODE_BINDING_INVALID');
    const adapter = createNativeHelperAdapter({
      entry_id: generation === 'V1' ? 'opencode_v1_task' : 'opencode_v2_subagent',
      observe_host_state: async () => {
        const current=read(),agent=await this.#observedAgent(current.helper_identity);
        if(!agent||agent.name!==current.helper_identity||agent.mode!=='subagent'||!agent.model?.providerID||!agent.model?.modelID
          ||!agent.options?.reasoningEffort||agent.variant!==agent.options.reasoningEffort)throw new Error('OPENCODE_ACTUAL_AGENT_UNVERIFIED');
        const state=compiler.trustedJsonCopy(current.host_state),route={provider:agent.model.providerID,model:agent.model.modelID,reasoning:agent.options.reasoningEffort};
        state.routing.native_defaults=route;state.routing.effective_route=route;return state;
      }, helper_identity: binding.helper_identity, source_capture: binding.source_capture, selection: binding.selection,
      session_id: binding.session_id,
      dispatch_native: () => ({ permission_check: 'VERIFIED', inference_dispatched: false })
    });
    const args = { ...output.args };
    if (typeof args.model === 'string' && args.model.includes('/')) {
      const [provider, model, extra] = args.model.split('/');
      if (extra) throw new Error('OPENCODE_MODEL_INVALID');
      args.provider = provider; args.model = model;
    }
    const result = await adapter.invoke({ hook_event_name: 'PreToolUse',
      tool_name: generation === 'V1' ? 'tool.execute.before/task' : 'ctx.tool.hook(execute.before)/subagent',
      session_id: input.sessionID, tool_input: args });
    if (result.decision !== 'ALLOW') throw new Error('Toolkit helper held: ' + result.code);
    // The installed V1 hook chain shares this exact args object with the tool.
    // Later before-hooks must not replace or mutate a request after admission.
    compiler.trustedJsonCopy(output.args);
    freezeNativeJson(output.args);Object.freeze(output);
  }
  // V1 chat.params is an additional provider-parameter check, not an assertion
  // that no later plugin/native transformation can change the route. Qualification
  // must independently establish the final selected provider boundary.
  async #finalParameters(input, output) {
    const generation=this.#generation,read=this.#read,parameterChecks=this.#parameterChecks;
    parameterChecks.delete(input.sessionID);
    const session = await this.#observedSession(input.sessionID);
    if (!session || session.id !== input.sessionID) throw new Error('OPENCODE_SESSION_OBSERVATION_INVALID');
    // Root sessions do not request a helper and must remain usable without a
    // helper binding. An observed child always requires the pinned authority.
    if (!session.parentID) return;
    const binding = read();
    if (session?.parentID !== binding.session_id) throw new Error('OPENCODE_HELPER_PARENT_MISMATCH');
    if (binding.api_generation !== generation || binding.schema !== 'toolkit.v3.native-helper-binding.v1') throw new Error('OPENCODE_BINDING_INVALID');
    if (input.agent !== binding.helper_identity) throw new Error('OPENCODE_LOADED_AGENT_MISMATCH');
    const model = input.model;
    if (!model?.api?.id || model.api.id !== model.id) throw new Error('OPENCODE_CONCRETE_MODEL_UNVERIFIED');
    const route = { provider: model?.providerID, model: model?.id, reasoning: output.options?.reasoningEffort };
    const entry_id = generation === 'V1' ? 'opencode_v1_task' : 'opencode_v2_subagent';
    const adapter = createNativeHelperAdapter({ entry_id,
      observe_host_state: () => {
        const current = read();
        const state = compiler.trustedJsonCopy(current.host_state);
        state.routing.effective_route = route;
        return state;
      }, helper_identity: binding.helper_identity, source_capture: binding.source_capture, selection: binding.selection, session_id: binding.session_id,
      dispatch_native: () => ({ permission_check: 'VERIFIED', inference_dispatched: false }) });
    const result = await adapter.invoke({ hook_event_name: 'PreToolUse',
      tool_name: generation === 'V1' ? 'tool.execute.before/task' : 'ctx.tool.hook(execute.before)/subagent',
      session_id: binding.session_id, tool_input: { subagent_type: input.agent, provider: route.provider, model: route.model, effort: route.reasoning } });
    if (result.decision !== 'ALLOW') throw new Error('OPENCODE_FINAL_ROUTE_MISMATCH: ' + result.code);
    // Keep the actual mutable native params object. The installed V1 host calls
    // chat.headers after every chat.params plugin, so replacement or mutation
    // by a later params plugin must be checked at that later boundary too.
    parameterChecks.set(input.sessionID, { input: this.#snapshot(input), output });
  }
  async #finalHeaders(input) {
    const parameterChecks=this.#parameterChecks;
    const session = await this.#observedSession(input.sessionID);
    if (!session || session.id !== input.sessionID) throw new Error('OPENCODE_SESSION_OBSERVATION_INVALID');
    if (!session.parentID) return;
    const earlier = parameterChecks.get(input.sessionID);
    parameterChecks.delete(input.sessionID);
    if (!earlier || compiler.hashCanonical(earlier.input) !== compiler.hashCanonical(this.#snapshot(input))) throw new Error('OPENCODE_PARAMETER_CHECK_REQUIRED');
    await this.#finalParameters(input, earlier.output);
    parameterChecks.delete(input.sessionID);
    // All params callbacks ran before headers. Seal the actual native params
    // object after the recheck, preventing a later headers callback from using
    // its retained params reference to change effort/options before dispatch.
    // This does not assert an unobserved later SDK/native transform is qualified.
    freezeNativeJson(earlier.output.options);Object.freeze(earlier.output);
  }
}
Object.freeze(OpenCodeHelperBoundary.prototype);
function createOpenCodeHelperHooks(options) {return new OpenCodeHelperBoundary(options);}
module.exports = Object.freeze({ createOpenCodeHelperHooks });
