# Codex SSH Hostinger Coolify Setup Maintainer

Production-minded skill for Hostinger VPS plus Coolify setup, deployment, daily security checks, optional Telegram/email daily notifications, intrusion-signal review, maintenance, and incident response. Use it when Codex should help set up Hostinger for deployment or maintain a Coolify host. Copy the whole skill folder, not just `SKILL.md`, so checklists, templates, scripts, and references stay available.

Boundary note: For Hostinger VPS plus Coolify deployment setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`. Use `n8n-local-setup` for local n8n and for the n8n-specific Hostinger Coolify VPS deployment reference after Coolify exists. If the target app is n8n or the task touches live n8n operations, also apply `n8n-agent-rules`.

## Contents

- `SKILL.md` - routing and safety contract.
- `agents/openai.yaml` - UI metadata and implicit-invocation policy.
- `checklists/` - bootstrap, deploy, daily security, maintenance, and incident response checklists.
- `templates/` - evidence reports, rollback plans, and owner approval logs; repo-side copies should live under `docs/hostinger-coolify/` or the repo's documented Hostinger/Coolify docs path.
- `scripts/daily-security-check.sh` - read-only report generator for `/data/maintenance/reports`, with optional owner-configured Telegram/local-email notification.
- `scripts/install-daily-security-check-systemd.sh` - installs a systemd service/timer and optional private env file without auto-remediation.
- `references/` - full first-party workflow reference.

## Safety Summary

Codex must inspect and report before changing anything, must not print secrets, must not disable SSH, must not enable UFW or apply restrictive firewall changes until recovery is documented, SSH is allowed first, the current SSH session stays open, and a second SSH session is tested, and must require explicit owner approval for production-sensitive actions.

Daily security checks are read-only reports plus optional owner-configured notification delivery. They must not change packages, restart services, mutate Docker, change firewall rules, or perform remediation. Intrusion checks are signals only and must not be described as proof that no intruder exists.
