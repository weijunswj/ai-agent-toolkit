<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Codex Platform Router

Codex can consume this toolkit through skills, `AGENTS.md`, and MCP config templates. This note routes to the local full-fidelity files that carry the actual runtime setup detail.

## Boundary

This is a short platform router. It is not the full runtime setup guide.

For full setup detail, use the local full-fidelity references and templates in this copied skill folder.

## Local Routes

- Use [local setup](../n8n/local-setup.md) for the full Windows local n8n and Codex setup guide.
- Use `skills/ai-coding-agent-rules/AGENTS.template.md` for generic Codex agent rules. Copy or merge it into the target repo root as `AGENTS.md` only when the user explicitly wants Codex rules installed.
- Use [n8n-mcp-rules.template.md](../../agent-rules/n8n-mcp-rules.template.md) as the n8n-specific add-on after the generic rules are installed.
- Use [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md) for the full Codex MCP config template.
- Restart Codex after changing MCP config, agent rules, or user environment variables.

## n8n MCP Notes

Use the docs server first for node discovery and validation. Use live n8n tools only when the user clearly asks for real instance inspection or mutation.

Keep live MCP tokens in user environment variables. Do not paste token values into this repo or consumer repo files.

## Smoke Tests

- Docs-only: ask Codex to find a no-credentials Manual Trigger plus Set pattern.
- Live read-only: ask Codex to list workflows and not modify anything.

Create live smoke-test workflows only after explicit confirmation.
