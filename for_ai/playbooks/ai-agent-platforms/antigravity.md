# Antigravity

Antigravity and Gemini-style tools can consume this toolkit through `GEMINI.md` and MCP config templates.

## Recommended Setup

1. Use [GEMINI.md](../../templates/agent-rules/GEMINI.md) for shared agent behavior.
2. Use [Antigravity MCP config](../../templates/mcp-configs/antigravity-mcp-config.md) when configuring n8n MCP access.
3. Restart the client after changing rules, MCP config, or user environment variables.

## Safety

Do not hardcode live n8n token values in config files. Keep tokens in user environment variables.

Use live n8n access only after docs-first design and explicit user intent.
