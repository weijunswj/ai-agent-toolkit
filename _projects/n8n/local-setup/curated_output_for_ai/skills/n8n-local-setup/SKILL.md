---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup with Docker Compose, Postgres, Compose ngrok, hosted n8n on Hostinger Coolify VPS, launcher/menu use, [official n8n Skills](https://github.com/n8n-io/skills) setup, and official instance-level MCP references. For any n8n workflow, helper-script, or live n8n task, first apply n8n-agent-rules.
---

<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, the Docker Compose local stack, Compose ngrok tunneling, hosted n8n on Hostinger Coolify VPS, the guided launcher/menu, [official n8n Skills](https://github.com/n8n-io/skills) routing, or official instance-level MCP references.

For Hostinger VPS plus Coolify setup or server maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer` first. Return to this skill for n8n-specific deployment guidance after Coolify exists.

For any n8n workflow, helper-script, [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill use, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n task, apply `n8n-agent-rules` first.

## Source And Runtime Material

- Runtime references live inside this copied skill folder under [references/n8n/](references/n8n/), with skills-first agent guidance under [references/ai-agent-platforms/](references/ai-agent-platforms/).
- Project provenance lives under [_projects/n8n/local-setup/](../../_projects/n8n/local-setup/) in the toolkit repo, but normal use of a copied skill folder must not require `_projects/`.

## Core Rules

- Use the local full-fidelity references in [references/n8n/](references/n8n/) for local setup, updates, Compose ngrok tunneling, Docker Compose plus Postgres, and hosted n8n Hostinger Coolify VPS details.
- Treat the Compose ngrok service as the supported local tunnel path in this guide.
- Use the local stack templates in [templates/local-stack/](templates/local-stack/) for local `n8n + postgres`.
- Treat [templates/local-stack/_n8n-local.cmd](templates/local-stack/_n8n-local.cmd) as the recommended local stack entrypoint for guided start, update checks, logs, status, URLs, Postgres backup packages, and local backup restore actions.
- Use [references/ai-agent-platforms/](references/ai-agent-platforms/) for Codex, Claude Code, OpenCode, Antigravity, ChatGPT web, Claude web routing, [official n8n Skills](https://github.com/n8n-io/skills) installation notes, and official instance-level MCP references.
- Use the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin instructions for Codex and Claude Code only where plugin hooks are supported and Windows hook metadata is safe. On Windows, bare `.sh` hook commands are not safe; use the official "Other platforms" route (`npx skills add n8n-io/skills`) plus the target repo `AGENTS.md` cue until the installed plugin invokes a real Windows-safe wrapper and hook emitters can output JSON with Node.
- For Antigravity/AG2, install or copy the official upstream n8n skill folders into the Antigravity plugin-scoped skill path, such as `C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\<skill-name>\SKILL.md`; verify `using-n8n-skills\SKILL.md` exists there before relying on Antigravity to load it.
- Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Local Antigravity plugin-scoped folder installs also do not include the official n8n plugin hooks. Make sure the target repo `AGENTS.md` cues the agent to load the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills`, before n8n work.
- [Official n8n Skills](https://github.com/n8n-io/skills) plus official instance-level MCP setup/config references are secondary and not part of the beginner local setup path.
- Use `skills/ai-coding-agent-rules` for generic AI coding agent rules.
- Use `skills/n8n-agent-rules` or [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for the full n8n operating ruleset.
- Keep tokens, API keys, and webhook secrets out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Generic Codex rules template: `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`
- n8n rules skill: `skills/n8n-agent-rules`
- n8n rules local reference: [references/n8n-agent-rules.md](references/n8n-agent-rules.md)
- [Official n8n Skills](https://github.com/n8n-io/skills) and agent guidance: [references/ai-agent-platforms/](references/ai-agent-platforms/)
- Docker Compose local stack: [templates/local-stack/docker-compose.yml](templates/local-stack/docker-compose.yml)
- Placeholder environment template: [templates/local-stack/.env.example](templates/local-stack/.env.example)
- Guided local stack launcher: [templates/local-stack/_n8n-local.cmd](templates/local-stack/_n8n-local.cmd)
- PowerShell local stack menu: [templates/local-stack/scripts/n8n-local-menu.ps1](templates/local-stack/scripts/n8n-local-menu.ps1), including local-only backup and restore recovery actions.
- Official instance-level MCP config templates: [templates/mcp-configs/](templates/mcp-configs/)
- Local setup reference: [references/n8n/local-setup.md](references/n8n/local-setup.md)
- Hostinger Coolify VPS n8n reference: [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md)
- Pack checklist: [packs/codex-n8n-local/pack.json](packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant local reference file inside this skill folder when exact setup detail matters.
3. Point the user to the AI-facing template, skill, or reference when they need copy-ready material.
4. Keep live actions safety-gated and separate from repo/docs/template work.
