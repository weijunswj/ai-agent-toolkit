# Page 3 - Production Self-Hosting With Cloudflare Tunnel

Use this page when you want to host n8n publicly from a local machine, home lab, office PC, mini PC, or other local/CGNAT machine through Cloudflare Tunnel.

This is the production self-hosting path for a local machine that cannot or should not accept inbound port forwarding. Cloudflare Tunnel runs an outbound `cloudflared` connector from your machine to Cloudflare, then Cloudflare routes your public hostname through that tunnel to n8n.

This is not the local development path. For local development and webhook testing, keep using [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) with localhost-first startup and the ngrok permanent/reserved URL mode.

* Dev webhook testing remains on the Compose ngrok permanent/reserved URL path.
* Production self-hosting from a local/CGNAT machine uses this separate Cloudflare Tunnel production stack.
* Do not use TryCloudflare or Quick Tunnel for this production path. If a quick tunnel smoke test is ever useful, keep it as a separate future smoke-test-only follow-up, not production hosting.
* Do not add Cloudflare production hosting controls to `_n8n-local.cmd`.
* Do not add Caddy, Traefik, Nginx, or another local reverse proxy for this CGNAT path. CGNAT needs an outbound tunnel, not an inbound local reverse proxy.
* Keep Postgres private.
* Do not expose n8n directly on a public host port such as `5678`.
* Configure backups before adding production credentials or workflows.
* Do not paste real tunnel tokens, domains, account IDs, DNS values, IPs, credentials, exports, backups, certs, or `.env` values into repo files or chats.

---

## 1. Which n8n Path Should You Use?

| Path | Use when | Public access model |
| --- | --- | --- |
| Local dev stack | You are learning, testing, building, or doing temporary webhook/OAuth development on your own Windows computer. | Localhost by default. Optional Compose ngrok permanent/reserved URL for dev callbacks. |
| Production Cloudflare Tunnel stack | You want a public production n8n instance on a local/CGNAT machine. | Cloudflare public hostname routes to an outbound `cloudflared` connector, then to `http://n8n:5678` inside Docker Compose. |
| Hostinger Coolify VPS n8n | You want n8n hosted on a VPS deployment platform. | Public DNS points to a VPS and Coolify/Traefik routes HTTPS to n8n internally. |

Use this page only for the production Cloudflare Tunnel stack. Keep [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) focused on localhost and ngrok dev usage.

Use [Page 2 - Hostinger Coolify VPS n8n](./Page%202%20-%20Hostinger%20VPS.md) when the production target is a VPS with Coolify instead of a local/CGNAT machine.

---

## 2. How Cloudflare Tunnel Fits CGNAT

Traditional inbound hosting normally needs an internet-routable address and port forwarding from the router to your machine. CGNAT often makes that unavailable because inbound traffic cannot be forwarded to your local device.

Cloudflare Tunnel uses an outbound connector:

```text
Public browser or webhook
  -> https://n8n.example.com
  -> Cloudflare
  -> Cloudflare Tunnel
  -> cloudflared container on your local machine
  -> n8n container internal port 5678
  -> private Postgres service
```

The local machine initiates the tunnel connection outward. Cloudflare then routes requests for the public hostname through that tunnel.

Cloudflare production hosting requires:

- A Cloudflare account.
- A user-owned domain or site added to Cloudflare.
- A Cloudflare Tunnel.
- A tunnel token for the `cloudflared` connector.
- A published public hostname for n8n.
- A service URL for that public hostname.

For this stack, the Cloudflare public hostname service URL should be:

```text
http://n8n:5678
```

That URL is internal to the Docker Compose network. It is not a public host port.

References:

- [Cloudflare create a tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Cloudflare Tunnel published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
- [Cloudflare Tunnel DNS records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Cloudflare Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [n8n webhook URL reverse proxy configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)

---

## 3. Production Stack Files

The production stack template folder is [templates/production-cloudflare-stack/](./templates/production-cloudflare-stack/).

| File or folder | Link |
| --- | --- |
| Production Docker Compose template | [docker-compose.yml](./templates/production-cloudflare-stack/docker-compose.yml) |
| Placeholder environment template | [.env.example](./templates/production-cloudflare-stack/.env.example) |
| Private runtime ignore template | [.gitignore](./templates/production-cloudflare-stack/.gitignore) |
| Windows production launcher | [_n8n-production-cloudflare.cmd](./templates/production-cloudflare-stack/_n8n-production-cloudflare.cmd) |
| Desktop shortcut launcher | [n8n-production-cloudflare-desktop-shortcut.cmd](./templates/production-cloudflare-stack/n8n-production-cloudflare-desktop-shortcut.cmd) |
| PowerShell production menu | [scripts/n8n-production-cloudflare-menu.ps1](./templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1) |
| Linux server backup template | [templates/production-server-backups/](./templates/production-server-backups/) |

The production Compose stack includes:

- `postgres`
- `n8n`
- `cloudflared`
- persistent volumes for Postgres and n8n
- no public Postgres port
- no public direct n8n host port; the browser port is loopback-only
- `cloudflared` using the tunnel token from environment

---

## 4. Create The Private Production Stack Folder

Use a private folder outside this repo.

Example shape:

```text
C:\n8n-production-cloudflare
```

or:

```text
%USERPROFILE%\.n8n-production-cloudflare
```

Do not put the production runtime folder inside this toolkit repo. Do not put it on a synced Desktop if `.env` or backups could be synced to a personal cloud account.

1. Create the private production stack folder.
2. Copy everything inside [templates/production-cloudflare-stack/](./templates/production-cloudflare-stack/) into that folder.
3. Copy `.env.example` to `.env`.
4. Fill `.env` privately.
5. Do not commit `.env`.
6. Optional: copy `n8n-production-cloudflare-desktop-shortcut.cmd` to your Desktop after the real stack folder is ready.

The copied folder should look like this:

```text
<PRODUCTION_STACK_FOLDER>
|-- docker-compose.yml
|-- .env.example
|-- .gitignore
|-- .env
|-- _n8n-production-cloudflare.cmd
|-- n8n-production-cloudflare-desktop-shortcut.cmd
`-- scripts\
    `-- n8n-production-cloudflare-menu.ps1
```

---

## 5. Fill `.env` Privately

Replace only the value after `=`.

Do not paste real values into this repo, issues, pull requests, screenshots, chats, or AI prompts.

| Variable | Required value | Rule |
| --- | --- | --- |
| `POSTGRES_DB` | Production database name. | `n8n` is fine unless you intentionally separate stacks. |
| `POSTGRES_USER` | Production database user. | `n8n` is fine unless you intentionally separate stacks. |
| `POSTGRES_PASSWORD` | Strong production database password. | Generate privately and store in a password manager. |
| `N8N_ENCRYPTION_KEY` | Long random key generated once. | Store outside the machine and never change after credentials exist. |
| `LOCAL_TIMEZONE` | IANA timezone. | Matches the local stack variable name. |
| `N8N_LOCAL_PORT` | Local browser port. | Same local-stack pattern: `5678` by default, or `5679` if `5678` is already used. |
| `N8N_IMAGE` | n8n image. | Default is `docker.n8n.io/n8nio/n8n:stable`; pin intentionally if needed. |
| `POSTGRES_IMAGE` | Postgres image. | Default is `postgres:16-alpine`. |
| `CLOUDFLARED_IMAGE` | Cloudflare connector image. | Default is `cloudflare/cloudflared:latest`; pin intentionally if needed. |
| `N8N_PUBLIC_HOST` | Your n8n subdomain/hostname only. | For example `n8n.example.com`. No `https://`, no path, no slash, no port. |
| `N8N_PUBLIC_URL` | Full public URL. | Must start with `https://` and end with `/`. |
| `CLOUDFLARED_TUNNEL_TOKEN` | Tunnel token from Cloudflare. | Store only in private `.env` or secret storage. |

Example placeholder shape:

```text
N8N_PUBLIC_HOST=n8n.example.com
N8N_PUBLIC_URL=https://n8n.example.com/
```

Use your real private production hostname in `.env`, not in repo files.

For n8n behind Cloudflare Tunnel, fill `N8N_PUBLIC_HOST` and `N8N_PUBLIC_URL` once. The launcher writes `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `N8N_HOST`, and `N8N_PROTOCOL` into `.env.active` when you choose a start mode, so the `.env` stays close to the local stack shape.

You can start Postgres and n8n locally before Cloudflare is ready. The local browser URL is:

```text
http://localhost:5678/
```

If you changed `N8N_LOCAL_PORT`, use that port instead. The production Compose file binds n8n to `127.0.0.1` only, so this local editor port is not a public exposure.

---

## 6. Create Cloudflare Tunnel And Public Hostname

Do this in Cloudflare, not in repo files.

1. Log in to Cloudflare.
2. Make sure the user-owned domain or site you will use for n8n is added to Cloudflare.
3. Create a Cloudflare Tunnel.
4. Copy the tunnel token into your private `.env` as `CLOUDFLARED_TUNNEL_TOKEN`.
5. Add a published application route or public hostname for n8n.
6. Use your chosen n8n hostname.
7. Set the public hostname service URL to:

   ```text
   http://n8n:5678
   ```

8. Save the route.
9. In `.env`, set `N8N_PUBLIC_HOST` and `N8N_PUBLIC_URL` to match the public hostname.

Cloudflare Tunnel DNS routes the hostname to the tunnel target. Cloudflare may create or expect a DNS route such as a CNAME to the tunnel target, depending on whether you use the dashboard route flow or CLI-managed DNS route flow.

Do not commit:

- real domains
- tunnel tokens
- account IDs
- DNS target values
- IP addresses
- screenshots showing private Cloudflare setup
- private deployment notes

---

## 7. Start n8n Locally

Open the private production stack folder and run:

```powershell
.\_n8n-production-cloudflare.cmd
```

Choose:

```text
Start n8n
Localhost only
```

This starts:

- Postgres
- n8n

It does not start `cloudflared`, and it does not require `CLOUDFLARED_TUNNEL_TOKEN`.

The base n8n preflight validates:

- `docker-compose.yml` exists.
- `.env` exists.
- `N8N_LOCAL_PORT` is a valid local port.
- Postgres has no public port mapping.
- n8n's browser port is loopback-only.

If `N8N_ENCRYPTION_KEY` or `POSTGRES_PASSWORD` is missing or still a placeholder, the base preflight warns but still allows local n8n to start. Replace both before saving credentials or production data you care about.

After startup, open:

```text
http://localhost:5678/
```

If you changed `N8N_LOCAL_PORT`, use that port instead.

---

## 8. Start Cloudflare Tunnel

Run this only after Cloudflare setup is ready.

From the menu, choose:

```text
Start n8n
Start Cloudflare tunnel
```

The Cloudflare preflight validates:

- `N8N_PUBLIC_HOST` is hostname-only.
- `N8N_PUBLIC_URL` starts with `https://` and ends with `/`.
- `N8N_PUBLIC_URL` uses the same hostname as `N8N_PUBLIC_HOST`.
- `CLOUDFLARED_TUNNEL_TOKEN` is present and not a placeholder.
- Postgres has no public port mapping.
- n8n's browser port is loopback-only.

If `N8N_ENCRYPTION_KEY` or `POSTGRES_PASSWORD` is still a placeholder, the Cloudflare preflight warns and continues.

If you only want local n8n without Cloudflare, keep using `Start n8n`; Cloudflare-specific values can wait.

---

## 9. Confirm Public Production Access

Start only after:

- Cloudflare account and user-owned domain/site setup are ready.
- Tunnel exists.
- Public hostname is configured.
- The public hostname service URL points to `http://n8n:5678`.
- Private `.env` is filled.
- Backups are planned.
- Preflight passes.

From the menu, choose:

```text
Start n8n
Start Cloudflare tunnel
```

The menu starts or keeps running:

- Postgres
- n8n
- cloudflared

After startup:

1. Check Cloudflare tunnel health in the Cloudflare dashboard.
2. Open the production URL in a browser.
3. Create the first n8n owner account.
4. Confirm a workflow can be saved.
5. Confirm a webhook URL shows the public HTTPS base URL.
6. Configure backups before adding production credentials or workflows.

---

## 10. Backups Before Credentials And Workflows

Do not add production credentials or workflows until backups exist.

At minimum:

1. Store `N8N_ENCRYPTION_KEY` in a password manager.
2. Create and test a Postgres backup and restore process.
3. Decide where private backups live.
4. Decide who can restore.
5. Take a backup before Postgres updates and before major n8n updates.

The production menu includes:

```text
Back up
```

`Back up` opens the production backup submenu:

1. `Back up now`
2. `Set up automatic backups`

`Back up now` writes a timestamped backup folder under the private stack folder's `backups\` directory. That folder contains one complete zip package with the private secret env file inside the zip when `.env` exists.

The manual production backup uses the same restore-compatible database-first shape as the local stack. It includes:

- timestamped folders named `n8n-production-YYYYMMDD-HHMMSS`
- `n8n-production-YYYYMMDD-HHMMSS.zip`
- `SECRET-DO-NOT-COMMIT.env` inside the zip when `.env` exists
- `database.sql` inside the zip
- `restore-manifest.json` inside the zip
- `HOW TO USE THIS RESTORE FOLDER.txt` inside the zip
- `README-PRIVATE.txt` inside the zip
- `backup.log` inside the zip
- retention cleanup with a 30-day default

`database.sql` is the full n8n Postgres database backup for this stack. It contains workflows, encrypted credential records, settings, users/projects, and other database-backed n8n state. The production Cloudflare menu does not create separate workflow or credential export folders by default because restore uses the database backup.

Backups may contain private workflows, executions, encrypted credential records, and private environment values. Keep them private. Do not commit backup zips, logs, database dumps, `SECRET-DO-NOT-COMMIT.env`, or production `.env` files.

`Set up automatic backups` uses Windows Task Scheduler for this Windows Cloudflare launcher. It prompts for cadence, retention, and destination, then schedules the same production backup zip package that `Back up now` creates. Scheduled backups require Windows, Task Scheduler, Docker Desktop, this production Cloudflare stack folder, and the local Postgres service to be available when the task fires.

For a Linux server or company-server deployment such as Hostinger/Coolify, use the copy-ready [production server backup template](./templates/production-server-backups/) and schedule it with systemd or cron. That server-side template is separate from this Windows Cloudflare launcher and is designed for Linux production deployments.

Offsite or cloud storage is intentionally not configured here. Treat offsite storage as a future hardening item after local/private server backups and restore have been proven and the storage pattern is approved.

---

## 11. Updates

Use the menu:

```text
Update
```

If the update includes Postgres, the menu runs `Back up` first and stops the update if the backup fails.

Update choices:

| Choice | Updates | Backup first? |
| --- | --- | --- |
| `all services` | Postgres, n8n, and cloudflared. | Yes |
| `n8n only` | n8n app image. | No |
| `postgres only` | Postgres image. | Yes |
| `cloudflared only` | Cloudflare connector image. | No |

Do not change `N8N_ENCRYPTION_KEY` during updates.

If the public hostname changes, update:

- `N8N_PUBLIC_HOST`
- `N8N_PUBLIC_URL`

Then restart n8n and verify editor and webhook URLs again.

---

## 12. Maintenance Commands

Use the production menu for normal operations:

| Menu item | Use when |
| --- | --- |
| `Start n8n` | Choose localhost-only or Cloudflare tunnel start mode. |
| `Restart n8n` | Apply n8n environment changes or restart the app container. |
| `Stop n8n` | Stop Cloudflare only, or stop the production stack without deleting volumes. |
| `Update` | Pull and recreate selected services, with backup before Postgres update. |
| `Show Compose status` | Inspect Compose service state and images. |
| `View logs` | Inspect recent logs for all services or one service. |
| `Back up` | Create a private restore-compatible backup folder containing one complete zip package with the private env copy inside when available, and retention cleanup. |
| `Advanced / Recovery: Restore local n8n from backup` | Restore a production backup zip after a pre-restore backup and `PROCEED` approval. |
| `Command list` | Show the recommended launcher and menu action summary. |

Restore reads `N8N_ENCRYPTION_KEY` from `SECRET-DO-NOT-COMMIT.env` or `.env` inside the selected zip, or from older sidecar env files beside the zip, and applies it to the active production `.env` before the restored database is started. If no backup key is found, the database restore can continue, but saved credentials may not decrypt unless the active `.env` already has the original key.

The preferred production restore input is a full backup zip containing `database.sql`. Older n8n entity export zips are accepted as an advanced compatibility path, including nested entity zips inside a newer backup package. Entity zip restore uses `n8n import:entities`, requires `migrations.jsonl`, may require the source `N8N_IMAGE`, and cannot restore account/login state as completely as `database.sql`.

Preflight is automatic on the launch, tunnel, backup, and update paths that need it. Do not run Docker Desktop's direct container buttons as the normal production control path. Use the production menu so preflight, backups, logs, status, recovery, and update choices stay visible.

---

## 13. What Not To Expose

Postgres must stay private.

Do not add:

- Postgres `ports:`
- Postgres public hostname
- Postgres Cloudflare route
- Postgres firewall opening
- Postgres public DNS record

n8n must not be exposed directly on public host port `5678`.

Do not add:

- `0.0.0.0:5678:5678`
- `5678:5678`
- router port forwarding to local `5678`
- public firewall rule for `5678`

Cloudflare should reach n8n through the tunnel service URL:

```text
http://n8n:5678
```

That is internal Docker networking, not public host exposure.

---

## 14. Safety Rules

- Use [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) for localhost and ngrok dev webhook testing.
- Use this page for production self-hosting from local/CGNAT machines with Cloudflare Tunnel.
- Keep Cloudflare production hosting controls out of the local dev menu.
- Do not add Caddy or Traefik to solve CGNAT hosting for this path. CGNAT needs the outbound Cloudflare Tunnel connector.
- Keep Postgres private.
- Do not expose n8n directly on public host port `5678`.
- Configure backups before adding production credentials or workflows.
- Do not paste real tunnel tokens, domains, account IDs, DNS values, credentials, exports, backups, certs, `.env` values, IPs, or private deployment notes into repo files or chats.
- Do not run live Cloudflare, DNS, tunnel, Docker, credential, workflow activation, import/export, or production actions from this toolkit repo without explicit current-turn approval naming the target and operation.

---

## 15. References

- [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md)
- [Page 2 - Hostinger Coolify VPS n8n](./Page%202%20-%20Hostinger%20VPS.md)
- [Production Cloudflare stack templates](./templates/production-cloudflare-stack/)
- [Cloudflare create a tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Cloudflare Tunnel published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
- [Cloudflare Tunnel DNS records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Cloudflare Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [n8n Docker hosting docs](https://docs.n8n.io/hosting/installation/docker/)
- [n8n webhook URL reverse proxy configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
