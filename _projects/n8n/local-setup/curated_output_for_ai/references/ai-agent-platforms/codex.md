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

Codex plugin/package support exists. For official `n8n-skills@n8n-io`, marketplace registration is not enough: before reporting setup complete, confirm Codex lists `n8n-skills@n8n-io` as installed and enabled, not merely available. On Windows, run Toolkit hook repair and audit on the installed plugin cache before trusting hooks; do not repair only the `.tmp\marketplaces\n8n-io\plugins\n8n-skills` checkout and call setup complete:

```powershell
node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root "<plugin-cache-path>" --windows --write --plugin-id n8n-skills@n8n-io
node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<plugin-cache-path>" --windows
```

## Local Routes

- Use [local setup](../n8n/local-setup.md) for the full local n8n and Codex setup guide.
- Use [local stack templates](../../templates/.n8n-local/) for `n8n + postgres + ngrok`.
- Use [skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for generic Codex agent rules. Copy or merge it into the target repo root as `AGENTS.md` only when the user explicitly wants Codex rules installed.
- Use `skills/n8n-agent-rules` or [n8n-agent-rules.md](../n8n-agent-rules.md) before workflow, helper-script, or live n8n work.
- Optionally merge `AGENTS.n8n-brief.template.md` from `skills/n8n-agent-rules/adapters/` into `AGENTS.md`; it is a pointer, not the full ruleset.
- Restart Codex after changing skills, agent rules, or user environment variables.

## Toolkit Boundary

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are secondary and not part of the beginner local setup path.

## Smoke Tests

- Rules-only: ask Codex to explain which local guide and skill references apply.
- Local repo: ask Codex to inspect copied templates and report whether `.env.example` remains placeholder-only.

Create live smoke-test workflows only after explicit confirmation.
