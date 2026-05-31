---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup with Docker Compose, Postgres, Compose ngrok, Hostinger VPS notes, launcher/menu use, skills-first routing, and optional AI-coding-agent MCP feature references. For any n8n workflow, helper-script, or live n8n task, first apply n8n-agent-rules.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, the Docker Compose local stack, Compose ngrok tunneling, Hostinger VPS notes, the guided launcher/menu, skills-first agent routing, or optional AI-coding-agent MCP feature references.

For any n8n workflow, helper-script, `n8n_docs`, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n task, apply `n8n-agent-rules` first.

## Source And Runtime Material

- Runtime references live inside this copied skill folder under [references/n8n/](references/n8n/), with skills-first agent guidance under [references/ai-agent-platforms/](references/ai-agent-platforms/).
- Project provenance lives under [_projects/n8n/local-setup/](../../_projects/n8n/local-setup/) in the toolkit repo, but normal use of a copied skill folder must not require `_projects/`.

## Core Rules

- Use the local full-fidelity references in [references/n8n/](references/n8n/) for local setup, updates, Compose ngrok tunneling, Docker Compose plus Postgres, and Hostinger VPS details.
- Treat the Compose ngrok service as the supported local tunnel path in this guide.
- Use the local stack templates in [templates/local-stack/](templates/local-stack/) for local `n8n + postgres`.
- Treat [templates/local-stack/_n8n-local.cmd](templates/local-stack/_n8n-local.cmd) as the recommended local stack entrypoint for guided start, update checks, logs, status, URLs, and Postgres backup actions.
- Use [references/ai-agent-platforms/](references/ai-agent-platforms/) for skills-first Codex, Claude Code, OpenCode, Antigravity, ChatGPT web, Claude web routing, and optional AI-coding-agent MCP feature references.
- Use direct whole-skill-folder installs for Codex and Claude Code, plugin-scoped skill-folder install for Antigravity, and short manual whole-skill-folder install notes for OpenCode. Keep whole skill folders together when copying.
- Defer Codex and Claude Code plugin/package packaging until the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup.
- Optional AI-coding-agent MCP feature setup/config references are secondary and not part of the beginner local setup path.
- Use `skills/ai-coding-agent-rules` for generic AI coding agent rules.
- Use `skills/n8n-agent-rules` or [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for the full n8n operating ruleset.
- Keep tokens, API keys, and webhook secrets out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Generic Codex rules template: `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`
- n8n rules skill: `skills/n8n-agent-rules`
- n8n rules local reference: [references/n8n-agent-rules.md](references/n8n-agent-rules.md)
- Skills-first agent guidance: [references/ai-agent-platforms/](references/ai-agent-platforms/)
- Docker Compose local stack: [templates/local-stack/docker-compose.yml](templates/local-stack/docker-compose.yml)
- Placeholder environment template: [templates/local-stack/.env.example](templates/local-stack/.env.example)
- Guided local stack launcher: [templates/local-stack/_n8n-local.cmd](templates/local-stack/_n8n-local.cmd)
- PowerShell local stack menu: [templates/local-stack/scripts/n8n-local-menu.ps1](templates/local-stack/scripts/n8n-local-menu.ps1)
- Optional MCP config templates: [templates/mcp-configs/](templates/mcp-configs/)
- Local setup reference: [references/n8n/local-setup.md](references/n8n/local-setup.md)
- Hostinger VPS reference: [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md)
- Pack checklist: [packs/codex-n8n-local/pack.json](packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant local reference file inside this skill folder when exact setup detail matters.
3. Point the user to the AI-facing template, skill, or reference when they need copy-ready material.
4. Keep live actions safety-gated and separate from repo/docs/template work.
