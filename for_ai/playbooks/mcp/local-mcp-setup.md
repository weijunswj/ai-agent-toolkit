# Local MCP Setup

Use local MCP setup when an AI agent needs structured access to local documentation or a local service.

## Safe Defaults

- Prefer read-only MCP servers first.
- Keep credentials in environment variables.
- Do not write token values into repo files.
- Use repo/docs/reference MCP tools before live mutation tools.
- Restart the AI client after changing MCP config.

## n8n Pattern

For n8n, use two separate concepts:

- `n8n_docs`: repo/docs/search/validation helper.
- `n8n_live`: live instance access, approval-gated and used only on request.

See [MCP config templates](../../templates/mcp-configs/) for platform-specific examples.
