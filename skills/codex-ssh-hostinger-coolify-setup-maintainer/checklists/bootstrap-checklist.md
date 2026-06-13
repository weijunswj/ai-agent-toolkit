<!--
Generated from toolkit project source. Do not edit directly.
Project: development.hostinger-coolify-production-guide
Source: _projects/development/hostinger-coolify-production-guide/_main/skill/checklists/bootstrap-checklist.md
Update the project source and run sync.
-->
# Bootstrap Checklist

- [ ] Pending - Confirm target host, OS, domain, intended apps, and owner goals.
- [ ] Pending - Confirm owner has Hostinger dashboard access and documented recovery access.
- [ ] Pending - Run read-only preflight: `whoami`, `hostnamectl`, `lsb_release -a` if available, `uname -a`, `df -h`, `free -h`, `uptime`, `ip addr`, `ss -tulpn`, `docker --version` if available, `docker ps` if available, `ufw status verbose` if available, and `systemctl status ssh --no-pager` if available.
- [ ] Pending - Write server evidence report under `docs/hostinger-coolify/` or the repo's documented Hostinger/Coolify docs path before any mutation.
- [!] Needs owner approval - Approve the named official Coolify install source URL before execution.
- [ ] Pending - Install Coolify only through the approved official path.
- [x?] Completed but needs human verification - Pause after installation for the owner to create the first Coolify admin account.
- [!] Needs owner approval - Configure firewall only after the recovery path is documented, SSH is allowed first, the current SSH session remains open, and a second SSH session has been tested.
- [ ] Pending - Verify Coolify health and write final bootstrap report under the same Hostinger/Coolify docs path.
