# Bootstrap Checklist

- [ ] Pending - Confirm target host, OS, domain, intended apps, and owner goals.
- [ ] Pending - Confirm owner has Hostinger dashboard access and documented recovery access.
- [ ] Pending - Run read-only preflight: `whoami`, `hostnamectl`, `lsb_release -a` if available, `uname -a`, `df -h`, `free -h`, `uptime`, `ip addr`, `ss -tulpn`, `docker --version` if available, `docker ps` if available, `ufw status verbose` if available, and `systemctl status ssh --no-pager` if available.
- [ ] Pending - Write server evidence report before any mutation.
- [!] Needs owner approval - Approve the named official Coolify install source URL before execution.
- [ ] Pending - Install Coolify only through the approved official path.
- [x?] Completed but needs human verification - Pause after installation for the owner to create the first Coolify admin account.
- [!] Needs owner approval - Configure firewall only after SSH allow rules and recovery path are documented.
- [ ] Pending - Verify Coolify health and write final bootstrap report.
