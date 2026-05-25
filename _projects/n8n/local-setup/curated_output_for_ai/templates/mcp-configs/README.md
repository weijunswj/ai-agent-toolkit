<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# MCP Config Templates

These source templates configure MCP access for different AI-agent platforms.

## Files

- [codex-mcp-config.md](codex-mcp-config.md)
- [claude-mcp-config.md](claude-mcp-config.md)
- [opencode-mcp-config.md](opencode-mcp-config.md)
- [antigravity-mcp-config.md](antigravity-mcp-config.md)

## Rules

- Keep live tokens in environment variables.
- Do not paste real token values into repo files.
- Use docs MCP access before live n8n access.
- Restart the target AI client after changing MCP config or environment variables.
