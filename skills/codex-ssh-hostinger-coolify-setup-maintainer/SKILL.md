---
name: codex-ssh-hostinger-coolify-setup-maintainer
description: Guide Codex through production-sensitive Hostinger VPS plus Coolify setup, SSH preflight, deployment, maintenance, daily security checks, optional Telegram/email daily notifications, intrusion-signal review, and incident response. Use when the user asks Codex to help set up Hostinger for deployment, prepare a Hostinger VPS, bootstrap or maintain Coolify, deploy apps through Coolify, inspect a Hostinger server over SSH, configure daily maintenance alerts, review possible intruders/security signals, or produce evidence-based PASS/WARN/FAIL maintenance reports with owner approval gates.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/curated_output_for_ai/skills/codex-ssh-hostinger-coolify-setup-maintainer/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.hostinger-coolify-production-guide
Review rule: Preserve production safety constraints. Do not weaken secret, SSH, firewall, DNS, reboot, destructive action, or owner-approval gates.
-->

# Codex SSH Hostinger Coolify Setup Maintainer

Use this skill when the user asks Codex to help set up Hostinger for deployment, prepare a Hostinger VPS, bootstrap or maintain Coolify, deploy apps through Coolify, inspect a Hostinger server over SSH, run daily security checks, configure daily maintenance alerts, review intrusion/security signals, perform maintenance, or respond to incidents. For Hostinger VPS plus Coolify deployment setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`.

Do not replace the n8n-specific Hostinger Coolify VPS deployment reference with this skill. Use this skill to prepare or maintain the Hostinger VPS plus Coolify host, then use `n8n-local-setup` for local n8n and for deploying n8n inside Coolify after Coolify exists. If the deployed app is n8n or the task touches live n8n workflows, credentials, import/export, activation, execution, or repo/live sync, also apply `n8n-agent-rules` before n8n-specific work.

## Operating Contract

- Treat the VPS as production-sensitive infrastructure.
- Inspect and report before changing anything.
- Preserve an evidence report for setup, deploy, security check, maintenance action, and incident action.
- Store repo-side evidence reports, owner approval logs, rollback plans, implementation notes, and incident notes under `docs/hostinger-coolify/` or the repo's documented Hostinger/Coolify docs path, and update those docs as the server state or deployment plan changes.
- Use evidence-based pass/fail maintenance wording.
- Do not describe setup or maintenance as complete, safe, or secure beyond the recorded evidence-based PASS/WARN/FAIL results.
- Do not ask the user to paste secrets into chat.
- Do not print secrets, tokens, private keys, cookies, database URLs, or env files.
- Do not ask the user to paste SSH private keys or production passwords into chat; use owner-controlled SSH/session tooling and owner-entered secrets.
- Prefer SSH key-only access, such as Ed25519 or strong RSA keys, but do not disable password authentication or change sshd configuration until key access, owner recovery access, the current session, and a second SSH session are verified.
- Treat `daily-security-check.sh` as read-only reporting and optional owner-configured notification delivery only: no package changes, service restarts, Docker mutations, firewall changes, or remediation actions.
- Treat intrusion checks as signals, not proof that no intrusion occurred.
- Store Telegram/email notification secrets only in owner-managed server config outside chat.

## Checklist Statuses

Use these exact statuses:

- `[ ] Pending`
- `[x] Completed`
- `[!] Needs owner approval`
- `[~] Not applicable with reason`
- `[x?] Completed but needs human verification`
- `[BLOCKED] Blocked with reason`

## Hard Safety Gates

- Do not disable SSH.
- Do not disable SSH password authentication or change sshd configuration until recovery access is documented, SSH key access is confirmed, the current SSH session is kept open, and a second SSH session has been tested.
- Do not enable UFW or apply restrictive firewall changes until the recovery path is documented, SSH allow rules are confirmed, the current SSH session is kept open, and a second SSH session has been tested.
- Do not expose database/cache/admin ports publicly by default.
- Do not delete Docker volumes, Coolify apps, databases, backups, or persistent data without explicit owner approval.
- Do not reboot without explicit owner approval unless the owner has pre-approved a maintenance window.
- Do not disable authentication on public services.
- Do not run destructive cleanup commands automatically.
- Do not modify DNS without explicit owner approval.
- Do not change production env vars without explicit owner approval.
- Do not install random third-party scripts except official documented installers that are explicitly part of the checklist.
- For official install scripts, record the source URL and require owner approval before execution.

## Owner-Only Actions

The owner must buy the VPS, secure the Hostinger account, create the first Coolify admin account, add secrets manually, approve firewall/reboot/destructive/DNS/env-var actions, verify backups/restores, and approve production DNS.

## Skill Materials

- Bootstrap checklist: [checklists/bootstrap-checklist.md](checklists/bootstrap-checklist.md)
- Deploy checklist: [checklists/deploy-checklist.md](checklists/deploy-checklist.md)
- Daily security checklist: [checklists/daily-security-checklist.md](checklists/daily-security-checklist.md)
- Maintenance checklist: [checklists/maintenance-checklist.md](checklists/maintenance-checklist.md)
- Incident response checklist: [checklists/incident-response-checklist.md](checklists/incident-response-checklist.md)
- Evidence templates: [templates/](templates/)
- Daily security scripts: [scripts/](scripts/)
- Full reference: [references/hostinger-coolify-production-guide.md](references/hostinger-coolify-production-guide.md)

## Default Workflow

1. Confirm target host, OS, domain, intended apps, and owner recovery access.
2. Run only read-only preflight commands until the owner approves a named change.
3. Write or update the relevant evidence report under `docs/hostinger-coolify/` or the repo's documented Hostinger/Coolify docs path.
4. Ask for explicit owner approval before installs, firewall changes, DNS changes, production deploys, env var changes, reboots, destructive actions, or official installer execution.
5. After any approved change, run smoke tests and record PASS/WARN/FAIL evidence.
