<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Official n8n Instance-Level MCP Template Index

These source templates point AI-coding-agent platforms at official n8n instance-level MCP access.

Skip these for the beginner local guide. Use them only when intentionally enabling n8n workflow work for an AI coding agent.

## Files

- [codex-mcp-config.md](codex-mcp-config.md)
- [claude-mcp-config.md](claude-mcp-config.md)
- [opencode-mcp-config.md](opencode-mcp-config.md)
- [antigravity-mcp-config.md](antigravity-mcp-config.md)

## Rules

- Keep live tokens in environment variables.
- Do not paste real token values into repo files.
- Use official n8n Skills first, then use the official n8n MCP tools that are actually available in the connected instance.
- Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities.
- Keep only the official instance-level MCP connection, normally named `n8n_live`.
- Restart the target AI client after changing MCP config or environment variables.
