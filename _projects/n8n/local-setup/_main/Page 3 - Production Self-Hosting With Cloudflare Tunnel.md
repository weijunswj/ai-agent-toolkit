# Page 3 - Production Self-Hosting With Cloudflare Tunnel

Use this page when you want to host n8n publicly from a local machine, home lab, office PC, mini PC, or other local/CGNAT machine through Cloudflare Tunnel.

This is the production self-hosting path for a local machine that cannot or should not accept inbound port forwarding. Cloudflare Tunnel runs an outbound `cloudflared` connector from your machine to Cloudflare, then Cloudflare routes your public hostname through that tunnel to n8n.

This is not the local development path. For local development and webhook testing, keep using [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) with localhost-first startup and the ngrok permanent/reserved URL mode.

* Dev webhook testing remains on the Compose ngrok permanent/reserved URL path.
* Production self-hosting from a local/CGNAT machine uses this separate Cloudflare Tunnel production stack.
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
- A domain or site added to Cloudflare.
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
| Windows production launcher | [_n8n-production-cloudflare.cmd](./templates/production-cloudflare-stack/_n8n-production-cloudflare.cmd) |
| PowerShell production menu | [scripts/n8n-production-cloudflare-menu.ps1](./templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1) |

The production Compose stack includes:

- `postgres`
- `n8n`
- `cloudflared`
- persistent volumes for Postgres and n8n
- no public Postgres port
- no public direct n8n host port `5678`
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

The copied folder should look like this:

```text
<PRODUCTION_STACK_FOLDER>
|-- docker-compose.yml
|-- .env.example
|-- .env
|-- _n8n-production-cloudflare.cmd
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
| `N8N_PUBLIC_HOST` | Hostname only. | No `https://`, no path, no slash, no port. |
| `N8N_PUBLIC_URL` | Full public URL. | Must start with `https://` and end with `/`. |
| `N8N_PROTOCOL` | Public protocol. | Use `https`. |
| `WEBHOOK_URL` | Full public URL. | Must exactly match `N8N_PUBLIC_URL`. |
| `N8N_EDITOR_BASE_URL` | Full public URL. | Must exactly match `N8N_PUBLIC_URL`. |
| `N8N_PROXY_HOPS` | Trusted proxy hop count. | Use `1` for this Cloudflare Tunnel path. |
| `CLOUDFLARED_IMAGE` | Cloudflare connector image. | Default is `cloudflare/cloudflared:latest`; pin intentionally if needed. |
| `CLOUDFLARED_TUNNEL_TOKEN` | Tunnel token from Cloudflare. | Store only in private `.env` or secret storage. |
| `GENERIC_TIMEZONE` | IANA timezone. | Example placeholder is `Etc/UTC`. |
| `N8N_IMAGE` | n8n image. | Default is `docker.n8n.io/n8nio/n8n:stable`; pin intentionally if needed. |
| `POSTGRES_IMAGE` | Postgres image. | Default is `postgres:16-alpine`. |

Example placeholder shape:

```text
N8N_PUBLIC_HOST=n8n.example.com
N8N_PUBLIC_URL=https://n8n.example.com/
WEBHOOK_URL=https://n8n.example.com/
N8N_EDITOR_BASE_URL=https://n8n.example.com/
```

Use your real private production hostname in `.env`, not in repo files.

For n8n behind Cloudflare Tunnel, set `WEBHOOK_URL` manually and set `N8N_PROXY_HOPS=1`. n8n uses those values to show and register the correct public webhook URLs when the app is behind a proxy or tunnel.

---

## 6. Create Cloudflare Tunnel And Public Hostname

Do this in Cloudflare, not in repo files.

1. Log in to Cloudflare.
2. Make sure the domain or site you will use for n8n is added to Cloudflare.
3. Create a Cloudflare Tunnel.
4. Copy the tunnel token into your private `.env` as `CLOUDFLARED_TUNNEL_TOKEN`.
5. Add a published application route or public hostname for n8n.
6. Use your chosen n8n hostname.
7. Set the public hostname service URL to:

   ```text
   http://n8n:5678
   ```

8. Save the route.
9. In `.env`, set `N8N_PUBLIC_HOST`, `N8N_PUBLIC_URL`, `WEBHOOK_URL`, and `N8N_EDITOR_BASE_URL` to match the public hostname.

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

## 7. Run Safety Preflight

Open the private production stack folder and run:

```powershell
.\_n8n-production-cloudflare.cmd
```

Choose:

```text
Safety preflight
```

The preflight validates:

- `N8N_PUBLIC_HOST` is hostname-only.
- `N8N_PUBLIC_URL` starts with `https://` and ends with `/`.
- `WEBHOOK_URL` matches `N8N_PUBLIC_URL`.
- `N8N_EDITOR_BASE_URL` matches `N8N_PUBLIC_URL`.
- `N8N_PROXY_HOPS` is `1`.
- `CLOUDFLARED_TUNNEL_TOKEN` is present and not a placeholder.
- `N8N_ENCRYPTION_KEY` is present and not a placeholder.
- `POSTGRES_PASSWORD` is present and not a placeholder.
- Postgres has no public port mapping.
- n8n direct `5678` is not publicly mapped.

Do not start production until preflight passes.

---

## 8. Start Production

Start only after:

- Cloudflare account and domain/site setup are ready.
- Tunnel exists.
- Public hostname is configured.
- The public hostname service URL points to `http://n8n:5678`.
- Private `.env` is filled.
- Backups are planned.
- Preflight passes.

From the menu, choose:

```text
Start production stack
```

The menu starts:

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

## 9. Backups Before Credentials And Workflows

Do not add production credentials or workflows until backups exist.

At minimum:

1. Store `N8N_ENCRYPTION_KEY` in a password manager.
2. Create and test a Postgres backup process.
3. Decide where private backups live.
4. Decide who can restore.
5. Take a backup before Postgres updates and before major n8n updates.

The production menu includes:

```text
Backup Postgres
```

It writes a timestamped backup folder under the private stack folder's `backups\` directory.

Backups may contain private workflows, executions, and encrypted credential records. Keep them private. Do not commit backups.

The menu intentionally does not copy `.env` or `N8N_ENCRYPTION_KEY` into backup folders. Store restore-critical secrets in a password manager or secret store.

---

## 10. Updates

Use the menu:

```text
Check/update images
```

If the update includes Postgres, the menu runs `Backup Postgres` first and stops the update if the backup fails.

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
- `WEBHOOK_URL`
- `N8N_EDITOR_BASE_URL`

Then restart n8n and verify editor and webhook URLs again.

---

## 11. Maintenance Commands

Use the production menu for normal operations:

| Menu item | Use when |
| --- | --- |
| `Safety preflight` | Before first launch, after `.env` changes, and before production updates. |
| `Start production stack` | Start Postgres, n8n, and cloudflared. |
| `Stop production stack` | Stop the production stack without deleting volumes. |
| `Restart n8n` | Apply n8n environment changes or restart the app container. |
| `View status` | Inspect Compose service state and images. |
| `View logs` | Inspect recent logs for all services or one service. |
| `Backup Postgres` | Create a private database backup. |
| `Check/update images` | Pull and recreate selected services, with backup before Postgres update. |
| `Print production URL` | Show `N8N_PUBLIC_URL` from private `.env`. |

Do not run Docker Desktop's direct container buttons as the normal production control path. Use the production menu so preflight, backups, logs, status, and update choices stay visible.

---

## 12. What Not To Expose

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

## 13. Safety Rules

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

## 14. References

- [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md)
- [Page 2 - Hostinger Coolify VPS n8n](./Page%202%20-%20Hostinger%20VPS.md)
- [Production Cloudflare stack templates](./templates/production-cloudflare-stack/)
- [Cloudflare create a tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Cloudflare Tunnel published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
- [Cloudflare Tunnel DNS records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Cloudflare Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [n8n Docker hosting docs](https://docs.n8n.io/hosting/installation/docker/)
- [n8n webhook URL reverse proxy configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
