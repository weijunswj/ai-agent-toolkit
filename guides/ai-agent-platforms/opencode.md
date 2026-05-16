# OpenCode

OpenCode can consume this toolkit through `AGENTS.md`, MCP config, and copied skills where supported.

## Recommended Setup

1. Use [AGENTS.md](../../templates/agent-rules/AGENTS.md) for shared agent behavior.
2. Use [OpenCode MCP config](../../templates/mcp-configs/opencode-mcp-config.md) for n8n docs and approval-gated live n8n access.
3. Keep live MCP URL and token values environment-backed.

## Safety

Configure live n8n tools as approval-gated. Do not allow broad live mutation without a user confirmation step.

Use docs-only MCP access for node discovery and validation before touching any real n8n instance.
