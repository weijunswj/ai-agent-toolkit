---
name: codex-ssh-hostinger-coolify-setup-maintainer
description: Guide Codex through production-sensitive Hostinger VPS plus Coolify setup, SSH preflight, deployment, daily security checks, evidence-based pass/fail maintenance, and incident response with owner approval gates.
---

<!--
Curated AI-facing source.
Project: development.hostinger-coolify-production-guide
Review rule: Preserve production safety constraints. Do not weaken secret, SSH, firewall, DNS, reboot, destructive action, or owner-approval gates.
-->

# Codex SSH Hostinger Coolify Setup Maintainer

Use this skill when the user asks Codex to help with Hostinger VPS, SSH-based server inspection, Coolify setup, Coolify deployment, daily security checks, maintenance, or incident response. For Hostinger VPS and Coolify setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`.

Do not use this skill for local n8n setup. Use `n8n-local-setup` for local n8n only.

## Operating Contract

- Treat the VPS as production-sensitive infrastructure.
- Inspect and report before changing anything.
- Preserve an evidence report for setup, deploy, security check, maintenance action, and incident action.
- Use evidence-based pass/fail maintenance wording.
- Do not describe setup or maintenance as complete, safe, or secure beyond the recorded evidence-based PASS/WARN/FAIL results.
- Do not ask the user to paste secrets into chat.
- Do not print secrets, tokens, private keys, cookies, database URLs, or env files.
- Treat `daily-security-check.sh` as read-only reporting only: no package changes, service restarts, Docker mutations, firewall changes, or remediation actions.

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
3. Write or update the relevant evidence report.
4. Ask for explicit owner approval before installs, firewall changes, DNS changes, production deploys, env var changes, reboots, destructive actions, or official installer execution.
5. After any approved change, run smoke tests and record PASS/WARN/FAIL evidence.
