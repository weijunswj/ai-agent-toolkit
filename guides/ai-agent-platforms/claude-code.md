# Claude Code

Claude Code can consume this toolkit through skills, `CLAUDE.md`, and user-scoped MCP config.

## Recommended Setup

1. Copy useful skill folders from `skills/` into a Claude Code skills location.
2. Copy `templates/agent-rules/CLAUDE.md` into the Claude Code memory/rules location used by your setup.
3. Use `templates/mcp-configs/claude-mcp-config.md` for user-scoped n8n MCP commands.
4. Restart Claude Code after changing rules, MCP config, or user environment variables.

## Scope

Prefer user-scoped MCP config for shared local tools. Use project-scoped config only when a project intentionally needs different MCP servers.

## Safety

Do not store live n8n tokens, API keys, or credentials in repo files. Use environment-backed configuration.
