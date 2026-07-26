---
name: n8n-local-setup
description: Use when setting up safe n8n environments: localhost/ngrok dev stack, production Cloudflare Tunnel self-hosting for local/CGNAT machines, hosted n8n on Hostinger Coolify VPS, production backup templates, launcher/menu use, official n8n Skills setup, or instance-level MCP references. For workflow, helper-script, or live n8n tasks, first apply n8n-agent-rules.
---

<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, the Docker Compose local dev stack, Compose ngrok dev tunneling, the separate production Cloudflare Tunnel self-hosting stack for local/CGNAT machines, hosted n8n on Hostinger Coolify VPS, production n8n backup templates, the guided launchers/menus, [official n8n Skills](https://github.com/n8n-io/skills) routing, or official instance-level MCP references.

For Hostinger VPS plus Coolify setup or server maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer` first. Return to this skill for n8n-specific deployment guidance after Coolify exists.

For any n8n workflow, helper-script, [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill use, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n task, apply `n8n-agent-rules` first.

## Source And Runtime Material

- Runtime references live inside this copied skill folder under [references/n8n/](references/n8n/), with skills-first agent guidance under [references/ai-agent-platforms/](references/ai-agent-platforms/).
- Project provenance lives under [_projects/n8n/local-setup/](../../_projects/n8n/local-setup/) in the toolkit repo, but normal use of a copied skill folder must not require `_projects/`.

## Core Rules

- Use the local full-fidelity references in [references/n8n/](references/n8n/) for local dev setup, updates, Compose ngrok dev tunneling, production Cloudflare Tunnel self-hosting for local/CGNAT machines, Docker Compose plus Postgres, and hosted n8n Hostinger Coolify VPS details.
- Treat the Compose ngrok service as the supported dev tunnel path for local webhook testing.
- Treat the production Cloudflare Tunnel stack as the production self-hosting path for local/CGNAT machines. Keep it separate from the local dev stack and menu.
- Do not treat TryCloudflare or Quick Tunnel as production hosting. If a quick tunnel smoke test is ever useful, keep it as a separate future smoke-test-only follow-up.
- Use the local stack templates in [templates/.n8n-local/](templates/.n8n-local/) for local `n8n + postgres`.
- Treat [templates/.n8n-local/_n8n-local.cmd](templates/.n8n-local/_n8n-local.cmd) as the recommended local stack entrypoint for fail-closed Docker CLI/Compose/engine preflight, official manual Docker Desktop guidance and clean exit when prerequisites are missing, safe startup of an already-installed Docker Desktop application, guided start, updates, logs, status, URLs, Postgres backup packages, and local backup restore actions. Toolkit does not install Docker Desktop.
- Local automatic backup prompts must say that pressing Enter accepts the recommended default. Recommended local contents are workflows plus encrypted credential exports; decrypted credential export stays disabled by default and still requires the exact `EXPORT DECRYPTED CREDENTIALS` confirmation phrase.
- Use [templates/.n8n-production-cloudflare/](templates/.n8n-production-cloudflare/) for production self-hosting from a local/CGNAT machine through Cloudflare Tunnel.
- Treat [templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd](templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd) as the production Cloudflare stack entrypoint with the same manual Docker prerequisite guidance and installed-Docker startup preflight as local. Production actions that start or recreate n8n must wait for stable configured-loopback readiness or report a bounded diagnostic timeout; intentional stop/down stays unwaited, and local readiness is distinct from tunnel health.
- Use [templates/production-server-backups/](templates/production-server-backups/) for Linux server backups on Hostinger/Coolify or company-server n8n deployments. That path uses n8n CLI workflow and credential exports, database backup where applicable, decrypted credential export disabled by default, manifest/log/restore notes, retention cleanup, and systemd timer or cron scheduling.
- Use [references/ai-agent-platforms/](references/ai-agent-platforms/) for Codex, Claude Code, OpenCode, Antigravity, ChatGPT web, Claude web routing, [official n8n Skills](https://github.com/n8n-io/skills) installation notes, and official instance-level MCP references.
- Use the official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin instructions for Codex and Claude Code where plugin hooks are supported. Marketplace registration alone is not installation: before reporting setup complete, verify `n8n-skills@n8n-io` is installed and enabled in the host plugin list, not merely available. On Windows, immediately run `node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root "<installed-plugin-cache-path>" --windows --write --plugin-id n8n-skills@n8n-io`, then `node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root "<installed-plugin-cache-path>" --windows --verify-output`, before approving or trusting hooks. Do not treat a temporary marketplace checkout such as `.tmp\marketplaces\n8n-io\plugins\n8n-skills` as the installed plugin cache.
- The Windows hook repair wrapper invokes explicit Git Bash only: `C:\Program Files\Git\bin\bash.exe` or `C:\Program Files\Git\usr\bin\bash.exe`. It rejects WSL/System32 Bash, including `C:\WINDOWS\system32\bash.exe`.
- If Codex or Claude Code opens `session-start.sh` on every new chat, the installed plugin still has an unsafe bare `.sh` hook on Windows. Run the repair command above against the installed plugin cache. If repair fails, audit fails, or hook JSON output verification fails, do not approve those hooks; use `npx skills add n8n-io/skills` and keep the target repo cue that loads `using-n8n-skills-official` before n8n work until the plugin can be repaired or updated.
- For Antigravity/AG2, install or copy the official upstream n8n skill folders into the Antigravity plugin-scoped skill path, such as `C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\<skill-name>\SKILL.md`; verify `using-n8n-skills-official\SKILL.md` exists there before relying on Antigravity to load it.
- Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Local Antigravity plugin-scoped folder installs also do not include the official n8n plugin hooks. Make sure the target repo `AGENTS.md` cues the agent to load the [official n8n Skills](https://github.com/n8n-io/skills) entry-point meta-skill, currently `using-n8n-skills-official`, before n8n work.
- [Official n8n Skills](https://github.com/n8n-io/skills) plus official instance-level MCP setup/config references are secondary and not part of the beginner local setup path.
- Use `skills/ai-coding-agent-rules` for generic AI coding agent rules.
- Use `skills/n8n-agent-rules` or [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for the full n8n operating ruleset.
- Keep tokens, API keys, webhook secrets, tunnel tokens, `.env` values, real domains, account IDs, DNS values, IPs, backups, exports, certs, and private deployment notes out of repo files and chats.
- Do not expose Postgres publicly.
- Do not expose n8n directly on public host port `5678`.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not run live Cloudflare, DNS, tunnel, Docker, credential, workflow activation, import/export, or production actions without explicit current-turn approval naming the target and allowed operation.
- For live n8n or production work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Generic Codex rules template: `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`
- n8n rules skill: `skills/n8n-agent-rules`
- n8n rules local reference: [references/n8n-agent-rules.md](references/n8n-agent-rules.md)
- [Official n8n Skills](https://github.com/n8n-io/skills) and agent guidance: [references/ai-agent-platforms/](references/ai-agent-platforms/)
- Docker Compose local stack: [templates/.n8n-local/docker-compose.yml](templates/.n8n-local/docker-compose.yml)
- Placeholder environment template: [templates/.n8n-local/.env.example](templates/.n8n-local/.env.example)
- Guided local stack launcher: [templates/.n8n-local/_n8n-local.cmd](templates/.n8n-local/_n8n-local.cmd)
- PowerShell local stack menu: [templates/.n8n-local/scripts/n8n-local-menu.ps1](templates/.n8n-local/scripts/n8n-local-menu.ps1), including local-only backup zip package and restore recovery actions.
- Production Cloudflare stack: [templates/.n8n-production-cloudflare/docker-compose.yml](templates/.n8n-production-cloudflare/docker-compose.yml)
- Production Cloudflare environment template: [templates/.n8n-production-cloudflare/.env.example](templates/.n8n-production-cloudflare/.env.example)
- Production Cloudflare runtime ignore template: [templates/.n8n-production-cloudflare/.gitignore](templates/.n8n-production-cloudflare/.gitignore)
- Guided production Cloudflare launcher: [templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd](templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd)
- Production Cloudflare desktop shortcut launcher: [templates/.n8n-production-cloudflare/n8n-production-cloudflare-desktop-shortcut.cmd](templates/.n8n-production-cloudflare/n8n-production-cloudflare-desktop-shortcut.cmd)
- PowerShell production Cloudflare menu: [templates/.n8n-production-cloudflare/scripts/n8n-production-cloudflare-menu.ps1](templates/.n8n-production-cloudflare/scripts/n8n-production-cloudflare-menu.ps1), including production preflight, logs, status, restore-compatible Postgres manual backup zip package, and image update actions.
- Linux production server backup guide: [templates/production-server-backups/README.md](templates/production-server-backups/README.md)
- Linux production server backup shell template: [templates/production-server-backups/n8n-production-backup.sh.template](templates/production-server-backups/n8n-production-backup.sh.template)
- Official instance-level MCP config templates: [templates/mcp-configs/](templates/mcp-configs/)
- Local setup reference: [references/n8n/local-setup.md](references/n8n/local-setup.md)
- Hostinger Coolify VPS n8n reference: [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md)
- Production self-hosting Cloudflare Tunnel reference: [references/n8n/production-cloudflare-tunnel.md](references/n8n/production-cloudflare-tunnel.md)
- Pack checklist: [packs/codex-n8n-local/pack.json](packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant local reference file inside this skill folder when exact setup detail matters.
3. Point the user to the AI-facing template, skill, or reference when they need copy-ready material.
4. Keep live actions safety-gated and separate from repo/docs/template work.
