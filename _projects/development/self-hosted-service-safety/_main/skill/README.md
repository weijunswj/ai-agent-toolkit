# Self-Hosted Service Safety

Small safety-review skill for non-n8n self-hosted service setup, Docker/VPS plans, reverse proxies, tunnels, public ports, credentials, backups, and first-run hardening.

## Use This Skill For

- A user asks to review a Docker Compose, VPS, reverse proxy, tunnel, DNS/TLS, or public-port setup for a self-hosted service.
- A setup guide includes admin panels, default credentials, webhooks, persistent volumes, backups, or production-like data.
- The user wants a safer first-run plan before exposing a service beyond localhost.
- The user wants to check public admin/backup paths, honeypot/canary paths, traffic logs, SSH access, or firewall port exposure before going live.

## Not For

- Do not use for ordinary feature work or local dev servers without self-hosting/deployment exposure.
- Do not use for n8n tasks; apply n8n-agent-rules and n8n-local-setup for n8n.
- Do not deploy, run Docker, open firewall ports, create DNS records, configure tunnels, edit credentials, or mutate a VPS/cloud service without explicit current-turn approval naming the target operation.

## Expected Output

Return a compact Self-Hosted Service Safety Review with risk level, blocked actions, approval-gated actions, safe first-run plan, required config changes, backup/restore notes, and verification checks before public exposure.
