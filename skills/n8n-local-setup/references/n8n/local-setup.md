<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/1. local setup.md
Update the project source and run sync.
-->
# 1. Local Setup

This is the primary one-stop-shop guide for local n8n on Windows.

Use it when you want a simple local stack with Docker Compose, Postgres, ngrok, the `n8n-local.cmd` menu, MCP setup, and agent platform setup in one place.

For always-on public hosting, keep using [4. VPS Hosting](vps-hosting.md). VPS and Hostinger hosting are separate from this local Docker Desktop setup.

## What This Guide Creates

The local Fast Path creates:

- `n8n`: the local n8n app.
- `postgres`: n8n's internal runtime database.
- `ngrok`: the supported local public tunnel when you choose to expose local n8n.
- `n8n_data` and `postgres_data`: persistent Docker volumes.
- `.env`: local-only runtime configuration copied from placeholder-only [.env.example](../../templates/local-stack/.env.example).
- [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd): the Windows launcher for the PowerShell menu.
- [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1): the guided menu for start, updates, logs, status, browser URLs, and Postgres backups.

The local Postgres service is only n8n's internal runtime database. It is not Vercel, it is not Supabase, and it must not connect to the user's app database.

ngrok is the only supported local public tunnel path in this guide. Cloudflare Quick Tunnel, Cloudflare named tunnels, manual Windows ngrok installs, and n8n's built-in tunnel are intentionally out of scope so beginners and agents have one path to follow.

## Fast Path

1. Install Docker Desktop, Node.js LTS, and your agent app.
2. Create the local stack folder. The folder can live anywhere, but this guide uses `%USERPROFILE%\Desktop\n8n-local`.
3. Copy [docker-compose.yml](../../templates/local-stack/docker-compose.yml), [.env.example](../../templates/local-stack/.env.example), [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd), and the [scripts folder](../../templates/local-stack/scripts/) into that local stack folder.
4. Copy `.env.example` to `.env`.
5. Paste placeholder replacements into `.env`, not PowerShell.
6. Start local-only n8n first and create the owner account at [http://localhost:5678](http://localhost:5678).
7. Start the ngrok tunnel only after the owner account exists.
8. Enable MCP in n8n, then configure Codex, Claude Code, OpenCode, or Antigravity with the matching MCP config template.
9. Use `n8n-local.cmd` for daily start, stop, status, logs, update checks, selected updates, URL opening, and Postgres backup.

Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live n8n imports/exports.

## Before You Start

### Install Docker Desktop

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).

Run this in PowerShell from any folder after installing Docker Desktop:

```powershell
docker --version
docker compose version
```

If Docker is installed but not running, start Docker Desktop and wait until it says the engine is ready.

### Install Node.js LTS

Install [Node.js LTS](https://nodejs.org/en/download).

Run this in PowerShell from any folder after installing Node.js:

```powershell
node -v
npm -v
npx --version
```

Node.js is needed for MCP helper commands used by the platform config templates.

### Install Your Agent App

Install whichever agent app you want to connect to n8n:

- [Codex app](https://openai.com/index/introducing-the-codex-app/)
- [Claude Desktop / Claude Code](https://claude.com/download)
- [OpenCode](https://opencode.ai/docs/)
- [Google Antigravity](https://antigravity.google/)

You can set up one platform first and add others later.

### Create Or Reserve Your ngrok Domain

Use the [ngrok dashboard](https://dashboard.ngrok.com/) to get an authtoken and, ideally, reserve a stable domain.

Do not paste the real authtoken into this repo. It belongs only in your local `.env` file or a password manager.

## Create The Local Stack Folder

### Recommended Example Path

The local stack folder can live anywhere. For this guide, the example location is the user's Desktop:

```text
%USERPROFILE%\Desktop\n8n-local
```

Run this in PowerShell from any folder:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Desktop\n8n-local"
Set-Location "$env:USERPROFILE\Desktop\n8n-local"
```

### Can I Put This Somewhere Else?

Yes. The folder can live anywhere you control.

If you choose another location, replace `%USERPROFILE%\Desktop\n8n-local` in this guide with your chosen folder. Keep it outside this toolkit repo so local `.env`, backups, Docker runtime files, and private setup notes do not end up in Git.

## Copy The Local Stack Templates

### Files To Copy

Copy these toolkit templates into the local stack folder:

- [docker-compose.yml](../../templates/local-stack/docker-compose.yml)
- [.env.example](../../templates/local-stack/.env.example)
- [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd)
- [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1), inside the `scripts` folder

Run this from the copied `n8n-local-setup` skill folder:

```powershell
Copy-Item -LiteralPath "templates\local-stack\docker-compose.yml" -Destination "$env:USERPROFILE\Desktop\n8n-local\docker-compose.yml" -Force
Copy-Item -LiteralPath "templates\local-stack\.env.example" -Destination "$env:USERPROFILE\Desktop\n8n-local\.env.example" -Force
Copy-Item -LiteralPath "templates\local-stack\n8n-local.cmd" -Destination "$env:USERPROFILE\Desktop\n8n-local\n8n-local.cmd" -Force
Copy-Item -LiteralPath "templates\local-stack\scripts" -Destination "$env:USERPROFILE\Desktop\n8n-local\" -Recurse -Force
```

### Folder Should Look Like This

Run this in PowerShell from `%USERPROFILE%\Desktop\n8n-local`:

```powershell
Get-ChildItem -Force
Get-ChildItem -Force .\scripts
```

The folder should contain:

```text
%USERPROFILE%\Desktop\n8n-local
  docker-compose.yml
  n8n-local.cmd
  scripts\
    n8n-local-menu.ps1
  .env.example
```

## Create And Fill `.env`

### Copy `.env.example` To `.env`

Run this in PowerShell from the local stack folder:

```powershell
Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force
```

Open `.env` in your editor.

### Values You Must Replace

Paste this into .env, not PowerShell.

```dotenv
POSTGRES_PASSWORD=replace-with-local-postgres-password
N8N_ENCRYPTION_KEY=replace-with-long-random-value
NGROK_AUTHTOKEN=replace-with-ngrok-authtoken
NGROK_DOMAIN=your-reserved-domain.ngrok.app
WEBHOOK_URL=https://your-reserved-domain.ngrok.app/
N8N_HOST=your-reserved-domain.ngrok.app
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1
```

Replace only placeholder values in your local `.env`. Keep the template [.env.example](../../templates/local-stack/.env.example) placeholder-only.

Use the same reserved ngrok domain in `NGROK_DOMAIN`, `N8N_HOST`, and `WEBHOOK_URL`.

- `NGROK_DOMAIN` has no `https://`.
- `N8N_HOST` has no `https://`.
- `WEBHOOK_URL` includes `https://` and a trailing slash.

Use a long random value for `N8N_ENCRYPTION_KEY` and store it in your password manager. n8n needs the same key after restarts to decrypt saved credentials.

### What Not To Commit

Do not commit:

- `.env`
- `.env.*` files with real values
- credentials
- webhook secrets
- private keys
- `.n8n-local/`
- `.tmp/`
- live n8n imports or exports
- local Postgres backups

## Start The Local Menu

### Run From The Local Stack Folder

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

The launcher opens the PowerShell menu from [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1).

### What The Menu Does

Use the menu for normal daily work:

- Start the stack.
- Check for updates.
- Apply selected updates.
- Restart or stop the stack.
- Show status.
- View all logs or service-specific logs.
- Open n8n.
- Open the ngrok inspector.
- Back up Postgres.
- Show the command reference.

Docker Desktop can also view containers and logs. Docker Desktop Play bypasses the menu and update checks, so start through `n8n-local.cmd` when you want guided checks, selected updates, backups, and clear status output.

## First Launch: Local-Only Owner Setup

### Start Local Stack

Create the owner account before exposing n8n through ngrok.

Run this in PowerShell from `%USERPROFILE%\Desktop\n8n-local`:

```powershell
docker compose up -d postgres n8n
docker compose ps
```

This starts local n8n and Postgres without starting the ngrok tunnel.

### Open n8n Locally

Open this URL in your browser:

[http://localhost:5678](http://localhost:5678)

Create the owner account locally on first launch.

### Create Owner Account Before Public Tunnel

Do not start the public tunnel until the owner account exists.

The tunnel exposes the full local n8n surface reachable through that URL path, including UI, API, webhook, and MCP routes. Treat it as public access to local n8n, not as a webhook-only pipe.

## Public Tunnel With ngrok

### What The Tunnel Exposes

The local tunnel shape is:

```text
outside service
-> https://your-reserved-domain.ngrok.app
-> ngrok Compose service
-> n8n Compose service on n8n:5678
```

Use the ngrok HTTPS URL when outside services need to reach local n8n for webhooks or OAuth callbacks.

You do not need ngrok just for a local agent talking to `http://localhost:5678`.

### Start Public Tunnel

Run this in PowerShell from the local stack folder after the owner account exists:

```powershell
docker compose up -d ngrok
docker compose ps
```

If you changed `.env`, recreate affected services from the local stack folder:

```powershell
docker compose up -d --force-recreate n8n ngrok
```

### Stop Public Tunnel

Run this in PowerShell from the local stack folder:

```powershell
docker compose stop ngrok
```

This stops the public tunnel while leaving local n8n and Postgres running.

To stop everything while keeping Docker volumes, run this in PowerShell from the local stack folder:

```powershell
docker compose down
```

### Show URLs

The menu shows the local n8n URL and ngrok inspector after a successful start, and it has browser actions for n8n and the ngrok inspector.

Run this in PowerShell from the local stack folder when you want to print the main URLs without opening a browser:

```powershell
Write-Host "n8n local:        http://localhost:5678"
Write-Host "ngrok inspector: http://127.0.0.1:4040"
Select-String -Path ".env" -Pattern "^(WEBHOOK_URL|NGROK_DOMAIN)="
```

Open this URL in your browser for local n8n:

[http://localhost:5678](http://localhost:5678)

Use the `WEBHOOK_URL` value from `.env` for external webhook and OAuth callback configuration.

### Open ngrok Inspector

Open this URL in your browser:

[http://127.0.0.1:4040](http://127.0.0.1:4040)

Use the inspector to see incoming tunnel requests, response codes, and request bodies while debugging local webhooks. Do not paste secrets or real customer data into repo files while debugging.

## Daily Use

### Start Stack

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Start stack` from the menu.

### Stop Stack

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Stop stack` from the menu. This keeps `n8n_data` and `postgres_data` volumes.

### Restart Stack

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Restart stack` from the menu.

### Show Status

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Show status` from the menu.

The raw command behind the menu is:

```powershell
docker compose ps
```

### View Logs

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose one of the log actions:

- `View all logs`
- `View n8n logs`
- `View ngrok logs`
- `View Postgres logs`

The raw commands behind the menu are:

```powershell
docker compose logs -f
docker compose logs -f n8n
docker compose logs -f ngrok
docker compose logs -f postgres
```

Press `Ctrl+C` to stop following logs.

### Back Up Postgres

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Backup Postgres database` from the menu.

The menu writes a timestamped SQL dump under a local `backups` folder. Do not commit backup files.

## Updates

### Check For Updates

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Check for updates`.

The check compares local image tag IDs before and after `docker compose pull`. It may pull newer images into the local Docker cache, but it does not restart or recreate running services.

### Apply Selected Updates

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

Choose `Update selected services`.

If Postgres is selected, the menu warns you to back up first. Postgres is pinned to major version 16 in [docker-compose.yml](../../templates/local-stack/docker-compose.yml).

### Why Updates Are Not Silent

The stack does not silently auto-update. Updating images and recreating containers are separate choices so a local user can:

- Back up first.
- Avoid surprise restarts.
- Update only selected services.
- Smoke test after changes.

## MCP Setup

### Enable MCP In n8n

Inside n8n:

1. Open `Settings`.
2. Open the instance-level MCP page.
3. Enable MCP access.
4. Copy the server URL.
5. Copy the access token.

For the default local stack, the local MCP URL is:

```text
http://localhost:5678/mcp-server/http
```

If you use MCP through the ngrok domain, use the MCP URL shown by n8n for that setup.

Reference: [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/).

### Codex MCP Config

Use the [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md).

Put `N8N_MCP_TOKEN` in a user environment variable, not in repo files. Restart Codex after changing MCP config, `AGENTS.md`, or `N8N_MCP_TOKEN`.

### Claude Code MCP Config

Use the [Claude MCP config](../../templates/mcp-configs/claude-mcp-config.md).

Put `N8N_MCP_URL` and `N8N_MCP_TOKEN` in user-scoped environment variables or the platform's supported secret storage, not in repo files. Fully close and reopen Claude Desktop after changing MCP config, `CLAUDE.md`, or MCP environment variables.

### OpenCode MCP Config

Use the [OpenCode MCP config](../../templates/mcp-configs/opencode-mcp-config.md).

Use user-scoped OpenCode config unless a project intentionally needs project-specific overrides. Restart OpenCode from a fresh PowerShell window after changing MCP config, `AGENTS.md`, or MCP environment variables.

### Antigravity MCP Config

Use the [Antigravity MCP config](../../templates/mcp-configs/antigravity-mcp-config.md).

Use user-scoped Antigravity or Gemini-style config unless a project intentionally needs project-specific overrides. Fully close and reopen Antigravity after changing MCP config, `GEMINI.md`, or MCP environment variables.

## Agent Rules And Adapters

### Generic Agent Rules

Use generic agent rules as the slim always-on baseline for coding agents:

- [AGENTS.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for Codex or OpenCode.
- [CLAUDE.template.md](../../../ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md) for Claude Code.
- [GEMINI.template.md](../../../ai-coding-agent-rules/repo-local/GEMINI.shim.template.md) for Gemini or Antigravity.

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

### n8n Agent Rules

Install or load [n8n Agent Rules](../../../n8n-agent-rules/) before n8n workflow, MCP, helper-script, import/export, credential, execution, repo/live sync, or live n8n work.

The local setup project references the n8n rules; it does not own them. Use the published [n8n Agent Rules](../../../n8n-agent-rules/) skill for the full operating contract.

### Optional Adapter

Optional adapters are brief pointers for existing instruction files:

- `AGENTS.n8n-brief.template.md` for Codex or OpenCode.
- `CLAUDE.n8n-brief.template.md` for Claude Code.
- `GEMINI.n8n-brief.template.md` for Gemini or Antigravity.

Do not copy the full n8n rules into always-on instructions unless you intentionally accept the context cost.

## Agent Platform Setup

### Codex

Use Codex with:

- [AGENTS.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n Agent Rules](../../../n8n-agent-rules/)
- [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md)

Restart Codex after changing `config.toml`, `AGENTS.md`, or `N8N_MCP_TOKEN`.

### Claude Code

Use Claude Code with:

- [CLAUDE.template.md](../../../ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md)
- [n8n Agent Rules](../../../n8n-agent-rules/)
- [Claude MCP config](../../templates/mcp-configs/claude-mcp-config.md)
- [Claude Code Integration appendix](../ai-agent-platforms/claude-code.md)

You do not need to open this repo in Claude Code just to use n8n MCP servers. Use the folder you actually want Claude Code to work in.

### OpenCode

Use OpenCode with:

- [AGENTS.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n Agent Rules](../../../n8n-agent-rules/)
- [OpenCode MCP config](../../templates/mcp-configs/opencode-mcp-config.md)
- [OpenCode Integration appendix](../ai-agent-platforms/opencode.md)

You can start OpenCode from any folder. Open a specific repo only when you want OpenCode to inspect or edit that repo.

### Antigravity

Use Antigravity with:

- [GEMINI.template.md](../../../ai-coding-agent-rules/repo-local/GEMINI.shim.template.md)
- [n8n Agent Rules](../../../n8n-agent-rules/)
- [Antigravity MCP config](../../templates/mcp-configs/antigravity-mcp-config.md)
- [Antigravity Integration appendix](../ai-agent-platforms/antigravity.md)

You can open any folder. Open a specific repo only when you want Antigravity to inspect or edit that repo.

## Troubleshooting

### Docker Is Not Running

Run this in PowerShell from any folder:

```powershell
docker info
```

If Docker reports that the engine is unavailable, start Docker Desktop and wait for it to finish. Then rerun the menu from the local stack folder:

```powershell
.\n8n-local.cmd
```

### `.env` Missing

Run this in PowerShell from the local stack folder:

```powershell
Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force
```

Then open `.env` and replace the placeholders. Paste values into .env, not PowerShell.

### ngrok Tunnel Not Available

Check `.env`:

```dotenv
NGROK_AUTHTOKEN=replace-with-ngrok-authtoken
NGROK_DOMAIN=your-reserved-domain.ngrok.app
```

`NGROK_DOMAIN` should be a reserved ngrok domain without `https://`.

Run this in PowerShell from the local stack folder after editing `.env`:

```powershell
docker compose up -d --force-recreate ngrok
docker compose logs -f ngrok
```

### Webhook URL Still Shows Localhost

Check `.env`:

```dotenv
WEBHOOK_URL=https://your-reserved-domain.ngrok.app/
N8N_HOST=your-reserved-domain.ngrok.app
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1
```

Run this in PowerShell from the local stack folder after editing `.env`:

```powershell
docker compose up -d --force-recreate n8n ngrok
```

Then refresh n8n and check the webhook node again.

### Port 5678 Already In Use

Run this in PowerShell from any folder:

```powershell
docker ps
```

Another local n8n process may already be running. Stop an old local test container only if you know it is disposable.

Do not remove Docker volumes unless you intentionally want to delete local n8n runtime data.

### MCP Tools Do Not Appear

Check:

- MCP is enabled inside n8n.
- The MCP URL matches your local or ngrok setup.
- `N8N_MCP_TOKEN` is set in the user environment, not pasted into repo files.
- The agent app was fully restarted after config changes.

Use docs/search MCP tools before live n8n tools. Use live n8n tools only when the user clearly asks for real instance inspection or mutation.

## Advanced Queue Mode

The default local Fast Path is normal mode: one n8n service runs the UI, API, webhooks, scheduler, and executions. Postgres stores durable n8n workflow, credential, user, and execution state.

Queue mode is a future production scaling path:

- n8n main serves the UI, API, webhooks, and scheduler.
- Redis queues execution jobs.
- n8n worker containers run executions.
- Postgres stores durable workflow, credential, user, and execution state.

Do not add Redis or workers to the default local Fast Path. Use queue mode later when production workloads need worker-based scaling.

## Safety Rules

- Create the owner account locally before starting the public tunnel.
- Treat the ngrok URL as public access to local n8n UI, API, webhooks, and MCP routes.
- Do not treat ngrok as production hosting.
- Do not expose the n8n container directly to the LAN or internet.
- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, encryption keys, or MCP tokens into repo files.
- Do not commit `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports.
- Do not remove `n8n_data` or `postgres_data` Docker volumes unless you intentionally want to delete local runtime data.
- Keep VPS/Hostinger setup separate in [4. VPS Hosting](vps-hosting.md).

## Appendices And References

- [2. Upgrading](upgrading.md) for focused local, VPS, and npm update notes.
- [3. Tunneling Guide](tunnelling.md) for focused ngrok tunnel behavior.
- [3a. Docker Compose + ngrok](docker-compose-ngrok.md) for template details.
- [4. VPS Hosting](vps-hosting.md) for Hostinger, VPS, Coolify, and production hosting.
- [5. Claude Code Integration](../ai-agent-platforms/claude-code.md) for Claude-specific setup detail.
- [6. OpenCode Integration](../ai-agent-platforms/opencode.md) for OpenCode-specific setup detail.
- [7. Antigravity Integration](../ai-agent-platforms/antigravity.md) for Antigravity-specific setup detail.
