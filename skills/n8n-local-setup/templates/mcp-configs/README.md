<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/templates/mcp-configs/README.md
Update the curated output and run sync.
-->
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
- Use official n8n Skills and official n8n MCP validation/build tools before proposing live-instance changes.
- Keep only the official instance-level MCP connection, normally named `n8n_live`.
- Restart the target AI client after changing MCP config or environment variables.
