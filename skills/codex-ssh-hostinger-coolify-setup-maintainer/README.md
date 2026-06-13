<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/curated_output_for_ai/skills/codex-ssh-hostinger-coolify-setup-maintainer/README.md
Update the curated output and run sync.
-->
# Codex SSH Hostinger Coolify Setup Maintainer

Production-minded skill for Hostinger VPS plus Coolify setup, deployment, daily security checks, maintenance, and incident response. Copy the whole skill folder, not just `SKILL.md`, so checklists, templates, scripts, and references stay available.

Migration note: For Hostinger VPS and Coolify setup/maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer`. The `n8n-local-setup` skill is for local n8n only.

## Contents

- `SKILL.md` - routing and safety contract.
- `checklists/` - bootstrap, deploy, daily security, maintenance, and incident response checklists.
- `templates/` - evidence reports, rollback plans, and owner approval logs.
- `scripts/daily-security-check.sh` - read-only report generator for `/data/maintenance/reports`.
- `scripts/install-daily-security-check-systemd.sh` - installs a systemd service/timer without auto-remediation.
- `references/` - full first-party workflow reference.

## Safety Summary

Codex must inspect and report before changing anything, must not print secrets, must not disable SSH, must not enable UFW until SSH allow rules and recovery are documented, and must require explicit owner approval for production-sensitive actions.
