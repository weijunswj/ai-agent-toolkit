<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Codex Platform Router

Codex can consume this toolkit through skills and `AGENTS.md`. This is a skills-first router; use the linked full-fidelity files for runtime setup detail.

## Boundary

This is a short platform overview and routing note. It is not the full runtime setup guide.

For full setup detail, use the local full-fidelity references and templates in this copied skill folder.

## Skill Install

Copy the whole `skills/<skill-name>/` folder.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Repo-level | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

Do not copy only `SKILL.md`. Keep supporting files beside it when present.

Codex plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex should use direct whole-skill-folder installs.

## Local Routes

- Use [local setup](../n8n/local-setup.md) for the full local n8n and Codex setup guide.
- Use [local stack templates](../../templates/local-stack/) for `n8n + postgres + ngrok`.
- Use [skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for generic Codex agent rules. Copy or merge it into the target repo root as `AGENTS.md` only when the user explicitly wants Codex rules installed.
- Use `skills/n8n-agent-rules` or [n8n-agent-rules.md](../n8n-agent-rules.md) before workflow, helper-script, or live n8n work.
- Optionally merge `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` into `AGENTS.md`; it is a pointer, not the full ruleset.
- Restart Codex after changing skills, agent rules, or user environment variables.

## Toolkit Boundary

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional AI-coding-agent MCP feature references are secondary and not part of the beginner local setup path.

## Smoke Tests

- Rules-only: ask Codex to explain which local guide and skill references apply.
- Local repo: ask Codex to inspect copied templates and report whether `.env.example` remains placeholder-only.

Create live smoke-test workflows only after explicit confirmation.
