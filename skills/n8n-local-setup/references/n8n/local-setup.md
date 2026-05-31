<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/Page 1 - Local Setup.md
Update the project source and run sync.
-->
# Page 1 - Local Setup

This is the beginner path for running n8n locally on Windows with Docker Desktop, Postgres, the guided `_n8n-local.cmd` menu, and optional ngrok public access.

Use [Page 2 - Hostinger VPS](hostinger-vps.md) instead when you want an always-on hosted server.

* Start local n8n first.
* Add ngrok only when something outside your computer must reach n8n.
* Keep this toolkit skills-first: humans use `_projects/**`; agents use `skills/**`.
* MCP setup/config is intentionally not shipped or maintained by this toolkit for now.
* Do not paste real tokens, credentials, `.env` values, backups, or live exports into repo files.

---

## 1. Fast Path ( Full Guide Below )

| Step | What to do | Where | Result |
| --- | --- | --- | --- |
| 1. | Install Docker Desktop. | Your Windows computer. | Docker Compose is available. |
| 2. | Create a local stack folder such as `C:\n8n-local`. | Windows Explorer. | Local runtime files stay outside this repo. |
| 3. | Copy everything inside [templates/local-stack/](../../templates/local-stack/) into your local stack folder. | Toolkit repo or copied skill folder. | The folder has Compose, `.env.example`, `_n8n-local.cmd`, and `scripts\`. |
| 4. | Copy `.env.example` to `.env`. | `<LOCAL_STACK_FOLDER>`. | You have a private local settings file. |
| 5. | Fill only local runtime values first. | `.env`. | Local n8n and Postgres can start. |
| 6. | Double-click `_n8n-local.cmd`. | `<LOCAL_STACK_FOLDER>`. | The guided menu opens and stays open after actions. |
| 7. | Choose `Start local n8n stack`. | Menu. | n8n starts locally without public exposure. |
| 8. | Open `http://localhost:5678` and create the owner account. | Browser. | Local n8n works before any public URL setup. |
| 9. | Add ngrok only if something outside your computer must reach n8n. | Docker Desktop extension. | You get a public URL for webhooks or OAuth callbacks. |

Do not save `.env`, tokens, backups, `.n8n-local/`, `.tmp/`, credentials, runtime payloads, or live n8n imports/exports into GitHub.

---

## 2. Before You Start

Do not ask for ngrok or public URL values before local n8n works. The order is:

1. Start local n8n.
2. Create the owner account at `http://localhost:5678`.
3. Confirm local n8n works.
4. Add a public ngrok URL only if needed.

| Need | Install or open | Quick check |
| --- | --- | --- |
| Docker runtime | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Docker Desktop says the engine is running. |
| Local stack folder | A folder you control, such as `C:\n8n-local`. | It is outside this repo and outside Git tracking. |
| ngrok account | [ngrok Docker Desktop setup](https://dashboard.ngrok.com/get-started/setup/docker-desktop) | Needed only when you need a public tunnel. |

Run these checks in PowerShell from any folder:

```powershell
docker --version
docker compose version
```

If Docker is installed but not running, open Docker Desktop and wait until the engine is ready.

---

## 3. Create The Local Stack Folder

Use a simple controlled path. Good choices:

| Location | Use when |
| --- | --- |
| `C:\n8n-local` | Best default for avoiding OneDrive Desktop redirection. |
| `C:\Users\<you>\Documents\n8n-local` | Good if you prefer user-owned folders. |
| Desktop | OK only if your Desktop is not OneDrive-redirected. |

OneDrive Desktop redirection can make local Docker/runtime files sync unexpectedly. If your Desktop path contains `OneDrive`, use `C:\n8n-local` or Documents instead.

This guide uses `<LOCAL_STACK_FOLDER>` as a placeholder. Replace it with your chosen folder path.

1. Create the folder in Windows Explorer.
2. Keep it outside this toolkit repo.
3. Do not put `.env`, backups, Docker volumes, private setup notes, or runtime data in a GitHub-tracked folder.

PowerShell fallback:

```powershell
New-Item -ItemType Directory -Force "C:\n8n-local"
```

---

## 4. Copy The Local Stack Templates

The local stack template folder is [templates/local-stack/](../../templates/local-stack/).

| File or folder | Link |
| --- | --- |
| Docker Compose template | [docker-compose.yml](../../templates/local-stack/docker-compose.yml) |
| Environment template | [.env.example](../../templates/local-stack/.env.example) |
| Windows launcher | [_n8n-local.cmd](../../templates/local-stack/_n8n-local.cmd) |
| Menu script | [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1) |

1. Open [templates/local-stack/](../../templates/local-stack/).
2. Select everything inside that folder.
3. Copy the selected files and folders.
4. Paste them into `<LOCAL_STACK_FOLDER>`.
5. Keep `docker-compose.yml`, `.env.example`, `_n8n-local.cmd`, and `scripts\` together.

PowerShell fallback from the toolkit repo root:

```powershell
New-Item -ItemType Directory -Force "C:\n8n-local"
Copy-Item -LiteralPath "_projects\n8n\local-setup\_main\templates\local-stack\*" -Destination "C:\n8n-local" -Recurse -Force
```

The copied folder should look like this:

```text
<LOCAL_STACK_FOLDER>
|-- docker-compose.yml
|-- .env.example
|-- _n8n-local.cmd
`-- scripts\
    `-- n8n-local-menu.ps1
```

---

## 5. Create And Fill `.env`

Copy `.env.example` to `.env`.

1. Open `<LOCAL_STACK_FOLDER>`.
2. Copy `.env.example`.
3. Paste the copy into the same folder.
4. Rename the copy to `.env`.
5. Do not edit `.env.example`.
6. If Windows creates `.env.txt`, rename it again so the file name is exactly `.env`.

PowerShell fallback:

```powershell
cd "C:\n8n-local"
Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force
```

Replace only the value after `=`. Do not add quotes unless the value itself requires them.

### Local Stack Runtime Values

Fill these before the first local launch:

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | A local database password. | `replace-with-local-postgres-password` becomes a private password. | Store it in a password manager. |
| `N8N_ENCRYPTION_KEY` | A long random value. | 32+ random characters. | n8n needs the same key after restarts to decrypt saved credentials. |
| `TZ` | Your local timezone. | `Asia/Singapore` | Keep or change intentionally. |
| `GENERIC_TIMEZONE` | Your local timezone. | `Asia/Singapore` | Keep aligned with `TZ`. |

Leave the public URL and ngrok placeholder values alone until local n8n works.

### Public n8n URL And Webhook Values

Use these only after you create a public endpoint:

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `WEBHOOK_URL` | The public n8n URL. | `https://your-name.ngrok.app/` | Include `https://` and the trailing slash. |
| `N8N_HOST` | The public host name. | `your-name.ngrok.app` | No `https://`. |
| `N8N_PROTOCOL` | The public protocol. | `https` | Use `http` for local-only defaults, `https` for ngrok. |
| `N8N_PROXY_HOPS` | Proxy hop count. | `1` | Keep this as `1` for local ngrok. |
| `NGROK_AUTHTOKEN` | Your ngrok authtoken. | Value from ngrok dashboard. | Needed only for the advanced Compose ngrok alternate. |
| `NGROK_DOMAIN` | Your reserved ngrok domain. | `your-name.ngrok.app` | Needed only for the advanced Compose ngrok alternate. |

The beginner path uses the ngrok Docker Desktop extension, so it does not require `NGROK_AUTHTOKEN` or `NGROK_DOMAIN` in `.env`.

## 6. First-Time Local n8n Setup

1. Open `<LOCAL_STACK_FOLDER>`.
2. Double-click `_n8n-local.cmd`.
3. Do not launch n8n directly from Docker Desktop. Launch it from `_n8n-local.cmd` instead.
4. Choose `Start local n8n stack`.
5. Open `http://localhost:5678`.
6. Create the owner account locally.
7. Confirm the editor loads and a workflow can be saved.

Docker Desktop direct launch bypasses guided checks, selected updates, backups, and clear status output.

PowerShell fallback:

```powershell
cd "C:\n8n-local"
docker compose up -d postgres n8n
docker compose ps
```

---

## 7. ngrok Public Tunnel Setup

Use ngrok only when another online service or remote AI agent cannot reach local n8n directly.

Examples:

- Webhooks from services such as Stripe, GitHub, Telegram, or Shopify.
- OAuth callbacks.
- An AI agent running somewhere that cannot reach `http://localhost:5678`.

### Beginner Default: ngrok Docker Desktop Extension

1. Create or sign in to an ngrok account.
2. Open [https://dashboard.ngrok.com/get-started/setup/docker-desktop](https://dashboard.ngrok.com/get-started/setup/docker-desktop).
3. Install the ngrok Docker Desktop extension.
4. Add your ngrok authtoken in the extension.
5. Start an endpoint from Docker Desktop for the n8n container.
6. Target n8n container port `5678`.
7. Use the generated public URL for n8n webhooks and OAuth callback configuration.
8. If you have a fixed/custom URL, choose it in the extension before using it in external services.

Free ngrok accounts get an assigned Dev Domain. Choosing or reserving custom domain names requires a paid plan. Bring-your-own-domain setup requires DNS/CNAME configuration in the domain's DNS provider.

Stopping an endpoint is not the same as deleting or releasing a reserved domain.

Do not run both the Docker Desktop extension endpoint and the Compose ngrok tunnel for the same n8n container at the same time.

### Advanced Alternate: Compose ngrok Service

The Compose file still includes an `ngrok` service for advanced/local alternate use. It is not the beginner default.

Only use this alternate if you intentionally want ngrok controlled by Docker Compose:

```powershell
cd "C:\n8n-local"
docker compose up -d ngrok
docker compose logs -f ngrok
```

If you use the Compose ngrok alternate, update `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `NGROK_AUTHTOKEN`, and `NGROK_DOMAIN` in `.env`, then recreate the affected services:

```powershell
cd "C:\n8n-local"
docker compose up -d --force-recreate n8n ngrok
```

---

## 8. Daily Use

Open `<LOCAL_STACK_FOLDER>`, double-click `_n8n-local.cmd`, then choose the action you need.

| Need | Menu option | Step 1 | Step 2 | What it does | PowerShell fallback |
| --- | --- | --- | --- | --- | --- |
| Start local n8n | `Start local n8n stack` | Launch `_n8n-local.cmd`. | Choose `Start local n8n stack`. | Starts Postgres and n8n locally. | `docker compose up -d postgres n8n` |
| Stop local n8n | `Stop local n8n stack` | Launch `_n8n-local.cmd`. | Choose `Stop local n8n stack`. | Stops containers without deleting Docker volumes. | `docker compose down` |
| Restart local n8n | `Restart local n8n stack` | Launch `_n8n-local.cmd`. | Choose `Restart local n8n stack`. | Restarts Postgres and n8n. | `docker compose restart postgres n8n` |
| Show status | `Show status` | Launch `_n8n-local.cmd`. | Choose `Show status`. | Shows Compose service status. | `docker compose ps` |
| View all logs | `View all logs` | Launch `_n8n-local.cmd`. | Choose `View all logs`. | Follows all Compose logs. | `docker compose logs -f` |
| View n8n logs | `View n8n logs` | Launch `_n8n-local.cmd`. | Choose `View n8n logs`. | Follows n8n logs. | `docker compose logs -f n8n` |
| View Postgres logs | `View Postgres logs` | Launch `_n8n-local.cmd`. | Choose `View Postgres logs`. | Follows Postgres logs. | `docker compose logs -f postgres` |
| View Compose ngrok logs | `View ngrok logs (advanced Compose tunnel)` | Launch `_n8n-local.cmd`. | Choose `View ngrok logs (advanced Compose tunnel)`. | Follows logs for the advanced Compose ngrok service. | `docker compose logs -f ngrok` |
| Back up Postgres | `Backup Postgres database` | Launch `_n8n-local.cmd`. | Choose `Backup Postgres database`. | Writes a timestamped SQL dump under a local `backups` folder. Keep it local and private. | Use the menu option. |
| Check image updates | `Check for updates` | Launch `_n8n-local.cmd`. | Choose `Check for updates`. | Pulls image metadata and compares image IDs without recreating running services. | `docker compose pull` |
| Update selected services | `Update selected services` | Launch `_n8n-local.cmd`. | Choose `Update selected services`. | Pulls and recreates only selected services. | `docker compose pull <service>` then `docker compose up -d --force-recreate <service>` |
| Update all services | `Update all services` | Launch `_n8n-local.cmd`. | Choose `Update all services`. | Pulls and recreates all declared services. Back up first. | `docker compose pull` then `docker compose up -d --force-recreate` |
| Open local n8n | `Open local n8n URL` | Launch `_n8n-local.cmd`. | Choose `Open local n8n URL`. | Opens `http://localhost:5678`. | Open `http://localhost:5678` in a browser. |
| Open ngrok extension guide | `Open ngrok Docker Desktop extension guide` | Launch `_n8n-local.cmd`. | Choose `Open ngrok Docker Desktop extension guide`. | Opens the ngrok Docker Desktop setup guide. | Open `https://dashboard.ngrok.com/get-started/setup/docker-desktop`. |
| Open help | `Help / command reference` | Launch `_n8n-local.cmd`. | Choose `Help / command reference`. | Shows raw commands behind the menu. | Use the menu option. |

Press `Ctrl+C` to stop following logs and return to the menu prompt.

---

## 9. Backup

Need:
`Back up Postgres`

Menu option:
`Backup Postgres database`

Steps:

1. Launch `_n8n-local.cmd`.
2. Choose `Backup Postgres database`.

What it does:

- Writes a timestamped SQL dump under a local `backups` folder.
- Keeps the backup local and private.
- Does not commit backup files.

PowerShell fallback:
Use the menu option.

---

## 10. Updating Local Instances

Launch `_n8n-local.cmd` once, then follow this update table.

| Step | Menu option | What it does | PowerShell fallback |
| --- | --- | --- | --- |
| 1 | `Check for updates` | Compares local image tag IDs before and after `docker compose pull`. It may pull newer images into the local Docker cache, but it does not restart or recreate running services. | `docker compose pull` |
| 2 | `Update selected services` | Applies selected updates. Back up first if Postgres is selected. Postgres is pinned to major version 16 in `docker-compose.yml`. | `docker compose up -d --force-recreate <service>` |
| 3 | `Update all services` | Applies all service updates. Back up first because n8n and Postgres containers may be recreated. | `docker compose up -d --force-recreate` |

Local update notes:

- n8n updates come from `docker.n8n.io/n8nio/n8n:stable`.
- Postgres is pinned to major version 16 in [docker-compose.yml](../../templates/local-stack/docker-compose.yml).
- The ngrok Docker Desktop extension updates through Docker Desktop Extensions.
- The Compose ngrok alternate uses `ngrok/ngrok:latest`.
- Local stack template/script updates come from this toolkit repo. Re-copy templates only after reviewing what changed.

---

## 11. Skills-First Agent Guidance

This toolkit is skills-first.

* Humans use `_projects/**` for source review and maintenance.
* Agents use `skills/**` after generated outputs are synced.
* MCP setup/config is intentionally not shipped or maintained by this toolkit for now.
* Use [n8n Agent Rules](../../../n8n-agent-rules/) before workflow, helper-script, import/export, credential, execution, repo/live sync, or live-instance work.

---

## 12. Troubleshooting

### Docker Is Not Running

1. Open Docker Desktop.
2. Wait for the engine to finish starting.
3. Relaunch `_n8n-local.cmd`.
4. Choose `Show status`.

### `.env` Is Missing

1. Copy `.env.example` to `.env`.
2. Replace only local runtime placeholders first.
3. Relaunch `_n8n-local.cmd`.

### Webhook URLs Still Show Localhost

1. Confirm local n8n works first.
2. Confirm your public endpoint works.
3. Set `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL`, and `N8N_PROXY_HOPS` intentionally.
4. Recreate n8n from the menu with `Update selected services` or with a fallback command.

### Port 5678 Is Already In Use

Another local n8n process may already be running. Stop old disposable test containers only if you know they are not needed.

Do not delete Docker volumes unless you intentionally want to delete local n8n runtime data.

---

## 13. Advanced Queue Mode

The default local path is normal mode:

- One n8n service handles UI, API, webhooks, scheduler, and executions.
- Postgres stores durable n8n workflow, credential, user, and execution state.

Queue mode is a later production scaling path:

- n8n main serves the UI, API, webhooks, and scheduler.
- Redis queues execution jobs.
- n8n worker containers run executions.
- Postgres stores durable workflow, credential, user, and execution state.

Do not add Redis or workers to the default local setup. Use queue mode later when production workloads need worker-based scaling.

---

## 14. Safety Rules

- Create the owner account locally before starting any public endpoint.
- Treat an ngrok URL as public access to local n8n UI, API, and webhooks.
- Do not treat ngrok as production hosting.
- Do not expose the n8n container directly to the LAN or internet.
- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, or encryption keys into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
- Do not remove `n8n_data` or `postgres_data` Docker volumes unless you intentionally want to delete local runtime data.
- Use [Page 2 - Hostinger VPS](hostinger-vps.md) for always-on hosted setup.

---

## 15. Appendices And References

| Reference | Use when |
| --- | --- |
| [Page 2 - Hostinger VPS](hostinger-vps.md) | You need always-on public hosting on Hostinger. |
| [Local stack templates](../../templates/local-stack/) | You need the Docker Compose, environment template, launcher, and menu script. |
| [n8n Agent Rules](../../../n8n-agent-rules/) | You need the full n8n operating rules before workflow/live n8n work. |
