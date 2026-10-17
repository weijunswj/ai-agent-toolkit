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
const { createOpenCodeHelperHooks } = require(__TOOLKIT_HELPER_RUNTIME_JSON__);
const TOOLKIT_API_GENERATION = __TOOLKIT_API_GENERATION_JSON__;
const TOOLKIT_ENTRY_BEGIN = '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/ai-coding-agent-execution.md:BEGIN OPENCODE SYSTEM ENTRY v1 -->';
const TOOLKIT_ENTRY_END = '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/ai-coding-agent-execution.md:END OPENCODE SYSTEM ENTRY -->';

export const AIAgentToolkitPlugin = async (ctx) => {
  if (TOOLKIT_API_GENERATION !== 'V1') throw new Error('OPENCODE_V2_PRE_DISPATCH_API_UNAVAILABLE');
  if (typeof ctx?.client?.session?.get !== 'function') throw new Error('OPENCODE_SESSION_OBSERVER_UNAVAILABLE');
  if (typeof ctx?.client?.app?.agents !== 'function') throw new Error('OPENCODE_AGENT_OBSERVER_UNAVAILABLE');
  const helper = createOpenCodeHelperHooks({ generation: TOOLKIT_API_GENERATION,
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
