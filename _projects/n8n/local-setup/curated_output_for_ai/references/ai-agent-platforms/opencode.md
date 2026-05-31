<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# OpenCode Platform Router

OpenCode can consume this toolkit through skills and repo-local instruction files when the target runtime is configured to read them. This is a skills-first router; use the linked full-fidelity files for runtime setup detail.

## Boundary

This is a short platform overview and routing note. It is not the full runtime setup guide.

For full setup detail, use the local full-fidelity references and templates in this copied skill folder.

## Skill Install

Copy the whole `skills/<skill-name>/` folder.

**Choose any one supported OpenCode skill-folder location:**

| Scope | Skill folder location |
| --- | --- |
| Repo-level | `<repo>/.opencode/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.config/opencode/skills/<skill-name>/SKILL.md` |
| Compatible agent folder | A compatible `.agents/skills/` or `.claude/skills/` location if that is how the target OpenCode runtime is configured. |

Do not copy only `SKILL.md`. Keep supporting files beside it when present.

## Local Routes

- Use [local setup](../n8n/local-setup.md) for the full local n8n setup guide.
- Use [local stack templates](../../templates/local-stack/) for `n8n + postgres + ngrok`.
- Use [skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for generic agent rules when OpenCode is reading `AGENTS.md`.
- Use `skills/n8n-agent-rules` or [n8n-agent-rules.md](../n8n-agent-rules.md) before workflow, helper-script, or live n8n work.

## Toolkit Boundary

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional AI-coding-agent MCP feature references are secondary and not part of the beginner local setup path.
