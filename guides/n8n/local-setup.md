<!--
Root published toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: n8n.local-setup
Review the related _projects/**/_main source when updating.
-->
# Local n8n Setup

## Goal

Run local n8n for development and connect AI agents through MCP without storing secrets in repo files.

## Basic Shape

1. Install Docker Desktop.
2. Install Node.js LTS.
3. Run n8n locally in Docker.
4. Enable instance-level MCP in n8n.
5. Configure an AI agent with:
   - a docs MCP server for node search and validation.
   - a live MCP endpoint for explicit live instance work.

## Defaults

- Local n8n URL: `http://localhost:5678`
- Local MCP endpoint: `http://localhost:5678/mcp-server/http`
- Keep live MCP tokens in user environment variables.

## Safety

Do not paste live MCP tokens into repo files. Do not create live workflows unless the user explicitly asks. Keep smoke-test workflows inactive by default.

## Templates

Use:

- [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md)
- [Claude MCP config](../../templates/mcp-configs/claude-mcp-config.md)
- [OpenCode MCP config](../../templates/mcp-configs/opencode-mcp-config.md)
- [Antigravity MCP config](../../templates/mcp-configs/antigravity-mcp-config.md)
