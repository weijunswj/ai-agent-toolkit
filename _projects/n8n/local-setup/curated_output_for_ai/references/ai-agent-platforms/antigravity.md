<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Antigravity Platform Router

This short router points to the full Antigravity setup guide. The authoritative Antigravity n8n Skills and MCP instructions are maintained in `_main/mcp setup - antigravity.md` and published to `skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md`.

For Antigravity/AG2, the official upstream n8n Skills entry point must be visible from an Antigravity plugin-scoped skill path:

```text
C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\using-n8n-skills\SKILL.md
```

Do not treat `$HOME\.agents\skills` or a loose `$HOME\.gemini\antigravity\skills` folder as the final AG2 install path. Use `npx skills add n8n-io/skills` only as an upstream fetch or install step when supported, then put the whole official n8n skill folders under the plugin-scoped `n8n-skills\skills` folder.

Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Local Antigravity plugin-scoped folder installs also do not include the official n8n plugin hooks, so keep the target repo `AGENTS.md` cue that loads the current official entry-point meta-skill, `using-n8n-skills`, before n8n work.

Use [local setup](../n8n/local-setup.md), [local stack templates](../../templates/.n8n-local/), and `skills/n8n-agent-rules` before workflow, helper-script, or live n8n work.
