/**
 * Generated OpenCode project-plugin template.
 *
 * toolkit-opencode-project-plugin.cjs embeds the canonical execution-rule
 * contract at this placeholder. Helper guards require a launcher-pinned binding.
 * Native execution remains unqualified until separately proven end to end.
 */
const TOOLKIT_EXECUTION_RULES = __TOOLKIT_EXECUTION_RULES_JSON__;
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TOOLKIT_HELPER_RUNTIME = __TOOLKIT_HELPER_RUNTIME_JSON__;
// SHA-256 of every source module the helper runtime loads, pinned when this file was
// rendered. The plugin loads that runtime from the Toolkit checkout, so a moved,
// missing or changed module must not silently change or remove enforcement.
const TOOLKIT_HELPER_RUNTIME_PINS = __TOOLKIT_HELPER_RUNTIME_PINS_JSON__;
const TOOLKIT_API_GENERATION = __TOOLKIT_API_GENERATION_JSON__;
const TOOLKIT_ENTRY_BEGIN = '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/ai-coding-agent-execution.md:BEGIN OPENCODE SYSTEM ENTRY v1 -->';
const TOOLKIT_ENTRY_END = '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/ai-coding-agent-execution.md:END OPENCODE SYSTEM ENTRY -->';
function heldError(code) { return Object.assign(new Error('Toolkit helper held: ' + code), { code }); }
function verifiedRuntime() {
  const fs = require('node:fs'), crypto = require('node:crypto');
  for (const [file, digest] of Object.entries(TOOLKIT_HELPER_RUNTIME_PINS)) {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { throw heldError('OPENCODE_HELPER_RUNTIME_MISSING'); }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest) throw heldError('OPENCODE_HELPER_RUNTIME_DRIFT');
  }
  return require(TOOLKIT_HELPER_RUNTIME);
}
// A plugin that fails to load leaves the native task tool unguarded, so every setup
// failure is held at the task boundary instead of being thrown from the factory.
function heldHooks(code, ctx) {
  // A session whose parentage cannot be observed is treated as a helper child.
  const childSession = async sessionID => {
    if (typeof ctx?.client?.session?.get !== 'function') return true;
    try {
      const session = (await ctx.client.session.get({ path: { id: sessionID } }))?.data;
      return !session || session.id !== sessionID || Boolean(session.parentID);
    } catch { return true; }
  };
  return {
    check: async input => { if (input?.tool === 'task') throw heldError(code); },
    finalParameters: async input => { if (await childSession(input?.sessionID)) throw heldError(code); },
    finalHeaders: async input => { if (await childSession(input?.sessionID)) throw heldError(code); }
  };
}
function helperHooks(ctx) {
  try {
    if (TOOLKIT_API_GENERATION !== 'V1') throw heldError('OPENCODE_V2_PRE_DISPATCH_API_UNAVAILABLE');
    if (typeof ctx?.client?.session?.get !== 'function') throw heldError('OPENCODE_SESSION_OBSERVER_UNAVAILABLE');
    if (typeof ctx?.client?.app?.agents !== 'function') throw heldError('OPENCODE_AGENT_OBSERVER_UNAVAILABLE');
    const { createOpenCodeHelperHooks } = verifiedRuntime();
    return createOpenCodeHelperHooks({ generation: TOOLKIT_API_GENERATION,
      binding_path: process.env.TOOLKIT_NATIVE_HELPER_BINDING,
      binding_sha256: process.env.TOOLKIT_NATIVE_HELPER_BINDING_SHA256,
      observe_agent: async name => {
        const response=await ctx.client.app.agents();
        if(!Array.isArray(response.data))throw new Error('OPENCODE_AGENT_OBSERVATION_INVALID');
        return response.data.find(agent=>agent.name===name);
      },
      observe_session: async sessionID => {
        if (typeof ctx?.client?.session?.get !== 'function') throw new Error('OPENCODE_SESSION_OBSERVER_UNAVAILABLE');
        const response = await ctx.client.session.get({ path: { id: sessionID } });
        return response.data;
      } });
  } catch (error) {
    return heldHooks(error.code || 'OPENCODE_HELPER_RUNTIME_UNAVAILABLE', ctx);
  }
}
export const AIAgentToolkitPlugin = async (ctx) => {
  const helper = helperHooks(ctx);
  return {
  'tool.execute.before': helper.check,
  'chat.params': helper.finalParameters,
  'chat.headers': helper.finalHeaders,
  'experimental.chat.system.transform': async (_input, output) => {
    if (!Array.isArray(output?.system)) return;
    const entry = [TOOLKIT_ENTRY_BEGIN, TOOLKIT_EXECUTION_RULES.trimEnd(), TOOLKIT_ENTRY_END].join('\n');
    if (output.system.some((item) => typeof item === 'string' && item.includes(entry))) return;
    output.system.push(entry);
  }
  };
};
// The V1 loader enumerates and deduplicates export identities; both exports
// refer to the same factory, so the actual callback owner is registered once.
export default AIAgentToolkitPlugin;
