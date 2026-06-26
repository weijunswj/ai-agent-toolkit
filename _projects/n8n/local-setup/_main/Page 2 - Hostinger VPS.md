# Page 2 - Hostinger Coolify VPS n8n

Use this page when you want an always-on public n8n server on a Hostinger VPS that is managed through Coolify.

This is not the local Docker Desktop path. If you are testing on your own Windows computer, start with [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md).

This is not the local/CGNAT Cloudflare Tunnel production path. If you want to host production n8n publicly from a local machine through an outbound Cloudflare Tunnel connector, use [Page 3 - Production Self-Hosting With Cloudflare Tunnel](./Page%203%20-%20Production%20Self-Hosting%20With%20Cloudflare%20Tunnel.md).

This is also not Hostinger's one-click n8n VPS template path. Choose the Hostinger Coolify VPS path when you want one VPS that can host n8n plus future apps, sites, databases, workers, or other Docker services under one deployment platform.

* Set up the Hostinger VPS and Coolify first.
* Deploy n8n from Coolify after Coolify is reachable.
* Keep secrets in Coolify or a password manager, not in repo files.
* Configure backups before adding production credentials or workflows.
* Do not use the local Windows `_n8n-local.cmd` launcher as a production deployment tool.

---

## 1. Which n8n Path Should You Use?

| Path | Use when | Public access model |
| --- | --- | --- |
| Local n8n setup | You are learning, testing, or building workflows on your own Windows computer. | Localhost by default; optional ngrok tunnel only when an external service must call your local machine. |
| Production Cloudflare Tunnel stack | You want production n8n publicly hosted from a local/CGNAT machine. | Cloudflare public hostname routes through an outbound `cloudflared` connector to n8n inside the local Docker Compose network. |
| Hostinger one-click n8n VPS template | You want Hostinger to provision a VPS that already has n8n-specific template material. | Hostinger template manages the n8n shape. This is not the Coolify platform path. |
| Hostinger Coolify VPS with n8n inside Coolify | You want one VPS to host n8n and future apps/sites/databases through Coolify. | Coolify reverse proxy handles HTTPS and routes public domains to internal app ports. |

Recommended hosted path:

- Use Hostinger Coolify VPS when you want a reusable deployment platform.
- Do not choose Hostinger's one-click n8n template when the goal is Coolify as the deployment platform.
- Complete the Hostinger VPS plus Coolify setup first using the [Codex SSH Hostinger Coolify Setup Maintainer](../../../../skills/codex-ssh-hostinger-coolify-setup-maintainer/) skill or its [full Hostinger Coolify reference](../../../../skills/codex-ssh-hostinger-coolify-setup-maintainer/references/hostinger-coolify-production-guide.md).
- Return to this page only after Coolify is reachable in a browser and the owner has created the first Coolify admin account.

Do not treat this page as approval to move private business data into a VPS. Confirm company policy, ownership, billing, data handling, backup, and restore responsibility first.

---

## 2. What You Actually Manage

You normally do not get a desktop or RDP-style graphical interface on the VPS.

You manage the setup through:

- Hostinger hPanel for VPS billing, server overview, IP address, snapshots, and provider-level controls.
- Browser Terminal or SSH for server-level commands when the Hostinger/Coolify maintainer guide asks for them.
- Coolify web dashboard for projects, resources, environment variables, domains, deploys, logs, and app restarts.
- Deployed app URLs such as `https://n8n.example.com`.

n8n is installed or deployed from Coolify. It is not installed by running the local Windows `_n8n-local.cmd` launcher.

The hosted production request flow should look like this:

```text
User browser / webhooks
  -> domain or temporary hostname
  -> Hostinger VPS IP
  -> Coolify reverse proxy / Traefik
  -> n8n container internal port 5678
  -> private Postgres service
```

Coolify/Traefik is the production reverse proxy layer. Do not add a second public reverse proxy inside the n8n stack unless you know exactly why and can explain the routing, TLS, headers, and failure modes.

---

## 3. Prerequisites

Finish these before deploying n8n:

- Hostinger VPS is purchased and recoverable by the correct owner.
- Coolify is installed, reachable, and healthy.
- The first Coolify admin account exists.
- SSH access and owner recovery path are understood.
- Firewall/security group allows HTTP `80`, HTTPS `443`, and SSH only as needed.
- A domain/subdomain or temporary hostname is chosen.
- A password manager or company secret store is ready.
- Backup ownership is assigned.

Use the separate Hostinger/Coolify guide for the VPS and Coolify platform setup. This page only covers deploying n8n after Coolify already exists.

---

## 4. Domain Or No-Domain Options

Preferred production option:

```text
n8n.example.com
```

Create an `A` record from that subdomain to the Hostinger VPS IP. Then configure the same hostname on the n8n resource in Coolify so Coolify can issue and renew HTTPS certificates.

Temporary or no-domain option:

- Use an IP-based DNS hostname such as `sslip.io` or `nip.io` style hostnames only when you need a temporary public hostname before real DNS is ready.
- Example shape only:

  ```text
  n8n.<vps-ip>.sslip.io
  ```

- Replace `<vps-ip>` only in your private deployment notes or Coolify UI. Do not commit the real VPS IP.

Avoid direct `http://<vps-ip>:5678` access except for disposable throwaway testing. Production n8n should be reached through Coolify HTTPS on `443`, with Coolify routing to the n8n container's internal port `5678`.

---

## 5. Required n8n Public URL Concepts

Set these values in Coolify's environment/secrets UI, not in repo files.

| Variable | Meaning | Example shape |
| --- | --- | --- |
| `N8N_HOST` | Public hostname only. No protocol and no path. | `n8n.example.com` |
| `N8N_PROTOCOL` | Public protocol users and webhooks use through Coolify. | `https` |
| `N8N_EDITOR_BASE_URL` | Public editor URL. | `https://n8n.example.com/` |
| `WEBHOOK_URL` | Public webhook base URL. Must include trailing slash. | `https://n8n.example.com/` |
| `N8N_PROXY_HOPS` | Number of trusted reverse-proxy hops in front of n8n. | `1` for a normal Coolify reverse proxy path |
| `N8N_ENCRYPTION_KEY` | Long random key used to encrypt credentials. Generate once, back up, and keep forever. | Generated secret, not a placeholder |
| `GENERIC_TIMEZONE` / `TZ` | Runtime timezone used by n8n and the container. Set both to the same value. | `Etc/UTC` or your operating timezone |

Rules:

- `N8N_HOST` should match the public hostname.
- `N8N_PROTOCOL` should be `https` when Coolify provides HTTPS.
- `N8N_EDITOR_BASE_URL` should match the public editor URL.
- `WEBHOOK_URL` should match the public webhook base URL and must end with `/`.
- `N8N_PROXY_HOPS` should be set for the reverse proxy setup instead of ignored.
- `N8N_ENCRYPTION_KEY` must be generated once, backed up outside the VPS and repo, and never changed after credentials exist. Changing it later can make existing n8n credentials unreadable.
- `GENERIC_TIMEZONE` and `TZ` should use the same timezone value.
- Do not paste real values into GitHub, chat, tickets, screenshots, or repo docs.

If the public domain changes later, update the public URL values in Coolify and verify both the editor URL and a webhook URL after redeploy.

---

## 6. Safe Starter Compose For Coolify

Use this as a starter shape for a Coolify-managed Docker Compose resource. Review current n8n hosting docs and your Coolify UI before production use.

This example intentionally:

- Has no ngrok or tunnel service.
- Does not expose Postgres publicly.
- Does not map public host port `5678`.
- Exposes n8n's internal `5678` for Coolify routing.
- Lets Coolify manage the deployment/default network instead of declaring a custom Compose network.
- Waits for Postgres to be healthy before starting n8n.
- Uses placeholders that must be filled in Coolify environment/secrets, not committed.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  n8n:
    image: docker.n8n.io/n8nio/n8n:stable
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
      N8N_HOST: ${N8N_HOST}
      N8N_PROTOCOL: ${N8N_PROTOCOL}
      N8N_EDITOR_BASE_URL: ${N8N_EDITOR_BASE_URL}
      WEBHOOK_URL: ${WEBHOOK_URL}
      N8N_PROXY_HOPS: ${N8N_PROXY_HOPS}
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true"
      N8N_RUNNERS_ENABLED: "true"
      GENERIC_TIMEZONE: ${GENERIC_TIMEZONE}
      TZ: ${GENERIC_TIMEZONE}
    volumes:
      - n8n_data:/home/node/.n8n
    expose:
      - "5678"

volumes:
  postgres_data:
  n8n_data:
```

Example placeholder values for Coolify environment/secrets:

```text
POSTGRES_DB=n8n
POSTGRES_USER=n8n
POSTGRES_PASSWORD=<generate-in-coolify-or-password-manager>
N8N_HOST=n8n.example.com
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://n8n.example.com/
WEBHOOK_URL=https://n8n.example.com/
N8N_PROXY_HOPS=1
N8N_ENCRYPTION_KEY=<generate-once-and-store-safely>
GENERIC_TIMEZONE=Etc/UTC
```

The placeholders above are not secrets by themselves, but real values may be sensitive. Keep production values in Coolify environment/secrets and your password manager. Do not commit real env values.

Coolify should publish only the n8n service, not Postgres. Configure Coolify's public route/domain on n8n and target the n8n service's internal container port `5678`. Do not add a public host port mapping for n8n.

Postgres must stay private. Do not add `ports:` for Postgres. Do not assign Postgres a public domain, public route, Coolify proxy route, VPS firewall opening, or Docker host port mapping for `5432`.

This starter does not declare a custom Compose network because a normal Coolify Docker Compose resource can use the deployment/default network Coolify creates for the resource. Only add custom networking when you can explain why Coolify's default resource networking is insufficient and how the proxy, service discovery, TLS, and backups will behave.

---

## 7. Deploy n8n In Coolify

Use Coolify's current UI, but keep this sequence:

1. Open the Coolify dashboard in your browser.
2. Create or choose the project/environment for n8n.
3. Add a Docker Compose resource or equivalent Coolify resource.
4. Paste or point Coolify to the reviewed Compose definition.
5. Add environment variables and secrets in Coolify.
6. Configure the public domain or temporary hostname for the n8n service.
7. In Coolify routing/proxy settings, publish only the n8n service.
8. Route the public n8n service to the n8n container's internal port `5678`.
9. Do not create any public domain, public route, proxy route, or public host port for Postgres.
10. Deploy.
11. Confirm Postgres becomes healthy and n8n starts after it.
12. Confirm Coolify/Traefik serves the n8n URL over HTTPS.
13. Open the public n8n URL in a browser.
14. Create the first n8n owner account.
15. Configure backups before adding production credentials or workflows.

Do not run the local Windows launcher on the VPS. The local launcher is for the Page 1 Windows/Docker Desktop setup only.

Do not run a second public reverse proxy inside the n8n stack unless you know exactly why. Coolify/Traefik is already the public reverse proxy layer in this path.

---

## 8. First-Launch Checklist

Before first production use:

- [ ] Coolify is already reachable.
- [ ] Hostinger VPS firewall/security group allows `80`, `443`, and SSH only as needed.
- [ ] Domain/subdomain or temporary hostname is decided.
- [ ] Coolify project/environment/resource is created.
- [ ] Env vars and secrets are filled in Coolify or a secret store, not committed.
- [ ] `WEBHOOK_URL` includes the trailing `/`.
- [ ] `N8N_ENCRYPTION_KEY` is generated once, backed up, and stored safely before credentials exist.
- [ ] n8n service is routed through Coolify/Traefik to internal port `5678`.
- [ ] Postgres healthcheck is passing.
- [ ] Postgres has no public port, public domain, public route, or proxy route.
- [ ] n8n owner account is created.
- [ ] Backups are configured before production credentials/workflows.
- [ ] A small safe test workflow can be saved.
- [ ] A webhook URL shows the intended public HTTPS base URL.

If any item is unknown, pause and resolve it before adding real credentials.

---

## 9. Backups And Restore Responsibility

Before real workflows:

1. Confirm Hostinger snapshot/backups or another VPS backup method.
2. Configure database/data backups appropriate for the Coolify resource.
3. Record who can restore.
4. Store `N8N_ENCRYPTION_KEY` outside the VPS and outside this repo.
5. Take a backup before updates or major config changes.

Minimum private SOP:

```text
VPS provider: Hostinger
Deployment platform: Coolify
n8n URL: https://n8n.example.com
Coolify project/resource: <fill privately>
Backup frequency: <fill privately>
Restore owner: <fill privately>
N8N_ENCRYPTION_KEY stored in: <password manager location>
```

Do not commit this SOP if it includes real domains, IPs, secrets, resource names, or operational details that should stay private.

---

## 10. Updating n8n In Coolify

Back up first.

Typical update flow:

1. Confirm the current backup is usable.
2. Check the current n8n image tag or digest.
3. Update the n8n image intentionally.
4. Redeploy from Coolify.
5. Check Coolify logs.
6. Open the n8n editor.
7. Confirm login works.
8. Open one workflow.
9. Run a small safe manual test.
10. Test one webhook.

Do not change `N8N_ENCRYPTION_KEY` during updates.

If the public domain changes, update `N8N_HOST`, `N8N_EDITOR_BASE_URL`, and `WEBHOOK_URL`, then verify the editor and webhook URLs again.

---

## 11. Maintenance Checklist

Regular maintenance:

- Back up Postgres and n8n data before updates.
- Keep `N8N_ENCRYPTION_KEY` safe and unchanged.
- Check Coolify and n8n logs after deploy/update.
- Verify webhook URL after domain changes.
- Do not expose database ports publicly.
- Review CPU, memory, disk, and execution volume before adding heavy workflows or workers.
- Confirm backups still run and can be restored.
- Keep Hostinger and Coolify ownership under the right person or company.

For Hostinger VPS, Coolify, firewall, SSH, DNS, daily security checks, intrusion-signal review, or incident response, use the [Codex SSH Hostinger Coolify Setup Maintainer](../../../../skills/codex-ssh-hostinger-coolify-setup-maintainer/) skill and its approval-gated workflow.

---

## 12. Local Reverse Proxy Note

Local Traefik, Caddy, or Nginx can provide reverse-proxy behavior on your own computer, but it is not a tunnel by itself.

- It can route local hostnames to local services.
- It does not make a local PC reachable from the public internet by itself.
- For local external webhook tests, the Page 1 ngrok tunnel path remains the simpler local option.
- For hosted production, use Coolify/Traefik on the VPS instead of trying to turn the local launcher into a production deploy tool.

Keep Traefik/Coolify production reverse-proxy guidance in this hosted path, not in the default Page 1 local launcher flow.

---

## 13. Safety Rules

- Do not choose Hostinger's one-click n8n template when the goal is Coolify-managed hosting.
- Do not paste VPS passwords, production env values, API tokens, webhook secrets, database passwords, or `N8N_ENCRYPTION_KEY` into repo files.
- Do not commit `.env`, `.env.*`, live exports/imports, backups, runtime payloads, or production Compose files with real values.
- Do not expose Postgres publicly.
- Do not expose raw n8n port `5678` publicly for production.
- Do not add ngrok/tunnel services to the hosted Coolify production stack.
- Do not modify DNS, firewall, production env vars, backups, or live deployments without owner approval.
- Do not activate workflows that touch live systems until they have been tested with safe data.
- Do not describe the VPS as safe or secure beyond recorded evidence from the Hostinger/Coolify maintainer workflow.

---

## 14. References

- [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md)
- [Page 3 - Production Self-Hosting With Cloudflare Tunnel](./Page%203%20-%20Production%20Self-Hosting%20With%20Cloudflare%20Tunnel.md)
- [Codex SSH Hostinger Coolify Setup Maintainer](../../../../skills/codex-ssh-hostinger-coolify-setup-maintainer/)
- [Hostinger Coolify maintainer full reference](../../../../skills/codex-ssh-hostinger-coolify-setup-maintainer/references/hostinger-coolify-production-guide.md)
- [n8n environment variable docs](https://docs.n8n.io/hosting/configuration/environment-variables/)
- [n8n webhook URL configuration docs](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
