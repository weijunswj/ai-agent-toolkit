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

## Skill Install

Preferred install: use the Codex plugin/package path. This repo root is a Codex plugin package because `.codex-plugin/plugin.json` sits beside `skills/`.

Do not copy a whole plugin root into `.agents/skills/`. Use direct `.agents/skills/` folders only as a fallback for individual skill folders. Keep `README.md`, references, templates, and any supporting files beside `SKILL.md`.

For local personal plugin development, keep the source as a plugin root such as `%USERPROFILE%\plugins\ai-agent-toolkit\`, then point `%USERPROFILE%\.agents\plugins\marketplace.json` at it. Treat cache copies as runtime state, not source.

## Local Routes

- Use [local setup](../n8n/local-setup.md) for the full Docker Compose local n8n and Codex setup guide.
- Use [local stack templates](../../templates/local-stack/) for the `n8n + postgres + ngrok` Fast Path.
- Use [skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for generic Codex agent rules. Copy or merge it into the target repo root as `AGENTS.md` only when the user explicitly wants Codex rules installed.
- Use `skills/n8n-agent-rules` or [n8n-agent-rules.md](../n8n-agent-rules.md) for the full n8n operating rules before workflow, MCP, helper-script, or live n8n work.
- Optionally merge `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` into `AGENTS.md`; it is a pointer, not the full ruleset.
- Use [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md) for the full Codex MCP config template.
- Restart Codex after changing MCP config, agent rules, or user environment variables.

## n8n MCP Notes

Use the docs server first for node discovery and validation. Use live n8n tools only when the user clearly asks for real instance inspection or mutation.

Keep live MCP tokens in user environment variables. Do not paste token values into this repo or consumer repo files.

## Smoke Tests

- Docs-only: ask Codex to find a no-credentials Manual Trigger plus Set pattern.
- Live read-only: ask Codex to list workflows and not modify anything.

Create live smoke-test workflows only after explicit confirmation.
