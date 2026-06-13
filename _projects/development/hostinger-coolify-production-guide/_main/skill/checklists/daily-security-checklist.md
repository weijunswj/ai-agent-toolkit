# Daily Security Checklist

- [ ] Pending - Review `/data/maintenance/reports/latest-security-check.md`.
- [ ] Pending - Confirm PASS/WARN/FAIL summary for disk, memory, reboot marker, updates, firewall, listening ports, Docker, Coolify containers, auth failures, critical logs, healthchecks, certificate expiry, and backup freshness where configured.
- [ ] Pending - If `BACKUP_PATHS` is configured, confirm every entry is an absolute backup directory path. Relative paths and leading-dash paths are rejected because daily checks must remain read-only.
- [!] Needs owner approval - Escalate any firewall, reboot, destructive cleanup, DNS, env var, backup restore, or production restart remediation.
- [x?] Completed but needs human verification - Owner reviews warnings that require dashboard, billing, DNS, backup, or app-level verification.

- [BLOCKED] Blocked with reason - Stop if a proposed daily check step would change packages, restart services, mutate Docker, change firewall rules, or perform remediation. Daily checks are read-only evidence collection only.
