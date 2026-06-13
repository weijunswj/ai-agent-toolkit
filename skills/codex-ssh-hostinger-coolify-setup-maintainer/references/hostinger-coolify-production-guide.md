<!--
Generated from toolkit project source. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/_main/hostinger-coolify-production-guide.md
Update the project source and run sync.
-->
# Codex SSH Hostinger Coolify Setup And Maintainer Workflow

This first-party workflow guides a non-DevOps owner and Codex through Hostinger VPS plus Coolify setup, deployment, evidence-based pass/fail maintenance, security checks, and incident response. Use it when Codex should help set up Hostinger for deployment or maintain a Coolify host. Treat the VPS as production-sensitive infrastructure. Codex must inspect and report before changing anything. Codex must describe setup and maintenance only through recorded evidence-based PASS/WARN/FAIL results.

For Hostinger VPS plus Coolify deployment setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`. Keep the n8n Hostinger VPS guide in `n8n-local-setup` for hosted n8n reference material. If the deployed app is n8n or the task touches live n8n workflows, credentials, import/export, activation, execution, or repo/live sync, also apply `n8n-agent-rules`.

## Required Checklist Statuses

Use only these statuses in checklists and reports:

- `[ ] Pending`
- `[x] Completed`
- `[!] Needs owner approval`
- `[~] Not applicable with reason`
- `[x?] Completed but needs human verification`
- `[BLOCKED] Blocked with reason`

## Hard Safety Rules

- Do not ask the user to paste secrets into chat.
- Do not print secrets, tokens, private keys, cookies, database URLs, or env files.
- Do not ask the user to paste SSH private keys or production passwords into chat; use owner-controlled SSH/session tooling and owner-entered secrets.
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

- Buy VPS.
- Keep Hostinger account secure.
- Create first Coolify admin account.
- Add secrets manually in Coolify or the relevant provider UI.
- Approve firewall, reboot, destructive, DNS, production env var, backup, restore, deploy, rollback, and incident-containment actions.
- Verify backups and restores.
- Approve production DNS.

## Bootstrap Flow

1. Confirm target host, OS, domain, and intended apps.
2. Confirm owner has Hostinger dashboard access and recovery access.
3. Run read-only preflight only:
   - `whoami`
   - `hostnamectl`
   - `lsb_release -a` if available
   - `uname -a`
   - `df -h`
   - `free -h`
   - `uptime`
   - `ip addr`
   - `ss -tulpn`
   - `docker --version` if available
   - `docker ps` if available
   - `ufw status verbose` if available
   - `systemctl status ssh --no-pager` if available
4. Write a server evidence report before any mutation.
5. Require owner approval before installing or changing anything.
6. Install Coolify using the official Coolify installation path only after approval; record the official source URL.
7. Pause immediately after installation and instruct the owner to create the first Coolify admin account before continuing.
8. Configure firewall only after documenting the recovery path, allowing SSH first, keeping the current SSH session open, and testing a second SSH session.
9. Verify Coolify health.
10. Write the final bootstrap report.

## Coolify Deploy Flow

Confirm repository, branch, Dockerfile or buildpack path, app healthcheck endpoint, required env vars, persistent volumes, public/private exposure, custom domain, SSL, and no committed secrets. Deploy only after owner approval when the target is production. Run healthchecks, inspect logs without printing secrets, record rollback plan, and write a deployment evidence report.

## Maintenance And Incident Standard

Every setup, deploy, security check, maintenance action, and incident action must preserve an evidence report. Use evidence-based pass/fail maintenance language: PASS means the observed check met the documented expectation, WARN means follow-up or human verification is needed, and FAIL means the observed state is unsafe, unavailable, or outside the expected boundary. Daily security checks are read-only reports only: no package changes, service restarts, Docker mutations, firewall changes, or remediation actions.

See the skill checklists and templates for copy-ready execution material.
