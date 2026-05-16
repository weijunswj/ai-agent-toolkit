# Codex

Codex can consume this toolkit through skills, `AGENTS.md`, and MCP config templates.

## Recommended Setup

1. Copy useful skills from `skills/` into your Codex-supported skills location.
2. Copy `templates/agent-rules/AGENTS.md` into the Codex rules location used by your environment.
3. Use `templates/mcp-configs/codex-mcp-config.md` when connecting Codex to n8n documentation and a live n8n MCP endpoint.
4. Restart Codex after changing MCP config, agent rules, or user environment variables.

## n8n MCP Notes

Use the docs server first for node discovery and validation. Use live n8n tools only when the user clearly asks for real instance inspection or mutation.

Keep live MCP tokens in user environment variables. Do not paste token values into this repo or consumer repo files.

## Smoke Tests

- Docs-only: ask Codex to find a no-credentials Manual Trigger plus Set pattern.
- Live read-only: ask Codex to list workflows and not modify anything.

Create live smoke-test workflows only after explicit confirmation.
