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

Copy the whole `skills/<skill-name>/` folder.

**Choose any one supported Codex skill-folder location:**

- `<repo>/.agents/skills/<skill-name>/SKILL.md`.
- `$HOME/.agents/skills/<skill-name>/SKILL.md`.
- `/etc/codex/skills/<skill-name>/SKILL.md`.

Do not copy only `SKILL.md`. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

Codex plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex should use direct whole-skill-folder installs.

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
