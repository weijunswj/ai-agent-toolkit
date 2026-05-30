<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/_Page 1. Local Setup.md
Update the project source and run sync.
-->
# Local Setup

This is the beginner-first guide for running local n8n on Windows.

Use it when you want one local setup path with Docker Compose, Postgres, ngrok, the `_n8n-local.cmd` menu, MCP setup, and AI agent platform notes.

For always-on public hosting, use [3. VPS Hosting](./vps-hosting.md). VPS and Hostinger hosting are separate from this local Docker Desktop setup.

## 1. Fast Path ( Full Guide Below )

| Step | What to do | Where | Result |
| --- | --- | --- | --- |
| 1. | Install Docker Desktop and Node.js LTS. | Your Windows computer. | Docker and Node are available. |
| 2. | Create `Desktop\n8n-local`. | Windows Explorer or PowerShell. | You have a local folder outside this repo. |
| 3. | Copy everything inside the [local stack template folder](../../templates/local-stack/) into `Desktop\n8n-local`. | Toolkit repo or copied skill folder. | The folder has Compose, `.env.example`, launcher, and `scripts\`. |
| 4. | Copy `.env.example` to a new file named `.env`. | `Desktop\n8n-local`. | You have a local settings file. |
| 5. | Replace placeholder values inside `.env`. | `.env`, not PowerShell. | n8n, Postgres, and ngrok have local settings. |
| 6. | Launch `_n8n-local.cmd`. | `Desktop\n8n-local`. | The guided menu opens. |
| 7. | Start local n8n first and create the owner account at [http://localhost:5678](http://localhost:5678). | Browser. | n8n is owned before any public tunnel starts. |
| 8. | Start ngrok only when an outside service needs to call local n8n. | `_n8n-local.cmd` menu. | Webhooks or OAuth callbacks can reach your local n8n. |
| 9. | Enable MCP in n8n, then use the matching platform config template. | n8n plus your agent app. | Codex, Claude Code, OpenCode, or Antigravity can connect. |

Do not save local secrets, `.env`, backups, runtime files, or live n8n import/export files into GitHub.

## 2. Before You Start

### 2.1. What Do I Need First?

| Need | Install or open | Quick check |
| --- | --- | --- |
| Docker runtime | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Docker Desktop says the engine is running. |
| Node.js for MCP helpers | [Node.js LTS](https://nodejs.org/en/download) | `node -v` works in PowerShell. |
| AI agent app | [Codex](https://openai.com/index/introducing-the-codex-app/), [Claude](https://claude.com/download), [OpenCode](https://opencode.ai/docs/), or [Antigravity](https://antigravity.google/) | The app opens and signs in. |
| ngrok account | [ngrok dashboard](https://dashboard.ngrok.com/get-started/setup/docker-desktop) | You can copy an authtoken and reserve a domain. |

Run this in PowerShell from any folder after installing Docker Desktop to confirm that it's successfully installed:

```powershell
docker --version
docker compose version
```

Run this in PowerShell from any folder after installing Node.js to confirm that it's successfully installed:

```powershell
node -v
npm -v
npx --version
```

Then run Docker Desktop, if it's not already running, and wait until it says the engine is ready.

### 2.2. Create And Reserve Your ngrok Domain

1. Register your [ngrok account](https://dashboard.ngrok.com/get-started/setup/docker-desktop).
2. Visit the [ngrok authtoken dashboard](https://dashboard.ngrok.com/get-started/your-authtoken) to get your ngrok authtoken.
4. Copy the authtoken.
5. Paste the authtoken from your ngrok dashboard into your local `.env` file. Do not share this value or commit it to GitHub.

### 2.3. Do I Need ngrok Right Away?

No.

If you are only opening n8n on your own computer, you do not need ngrok.

Use ngrok when another online service must call your local n8n webhook or OAuth callback.

## 3. Create The Local Stack Folder

### 3.1. Create Your Local n8n Folder

1. Open your Desktop.
2. Create a folder named `n8n-local`.
    - Keep this folder outside the toolkit repo.

### 3.2 Can I Put This Somewhere Else?

Yes. The folder can live anywhere you control.

If you choose another location:

1. Replace `Desktop\n8n-local` in this guide with your chosen folder.
2. Keep it outside this toolkit repo.
    - Do not place local `.env`, backups, Docker runtime files, or private setup notes in GitHub-tracked folders.

## 4. Copy The Local Stack Templates

### 4.1. Copy The Whole Template Folder Contents

The local stack template folder is [templates/local-stack/](../../templates/local-stack/), consisting of the following:

| File or folder | Link |
| --- | --- |
| Docker Compose template | [docker-compose.yml](../../templates/local-stack/docker-compose.yml) |
| Environment template | [.env.example](../../templates/local-stack/.env.example) |
| Windows launcher | [_n8n-local.cmd](../../templates/local-stack/_n8n-local.cmd) |
| Menu script | [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1) |

1. Open [templates/local-stack/](../../templates/local-stack/).
2. Select everything inside that folder.
3. Copy the selected files and folders.
4. Paste them into `Desktop\n8n-local`.
   - Copy **everything** from the local-stack folder. **Do not exclude anything.**

## 5. Create And Fill `.env`

### 5.1. Clone `.env.example` Into `.env`

1. Open `Desktop\n8n-local`.
2. Copy the `.env.example` file.
3. Paste the copy into the same folder.
4. Rename the new copy as `.env`.
   - Do not edit `.env.example`.
   - If Windows creates `.env.txt`, rename it again so the file name is exactly `.env`.

### 5.2. Replace Placeholder Values

1. Open `.env`.
2. Find the placeholder value.
3. Replace only the value after `=`.
4. Save the file.

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | Any local database password. | `replace-with-local-postgres-password` becomes a private password. | Store it in a password manager. |
| `N8N_ENCRYPTION_KEY` | Any long random value. | 32+ random characters. | n8n needs the same key after restarts to decrypt saved credentials. |
| `NGROK_AUTHTOKEN` | Your ngrok authtoken. | Value from the [ngrok authtoken page](https://dashboard.ngrok.com/get-started/your-authtoken). | Do not share it or commit it to GitHub. |
| `NGROK_DOMAIN` | Your reserved ngrok domain. | `your-name.ngrok.app` | No `https://`. |
| `WEBHOOK_URL` | The public n8n URL. | `https://your-name.ngrok.app/` | Include `https://` and the trailing slash. |
| `N8N_HOST` | The same reserved ngrok domain you've input into `NGROK_DOMAIN`. | `your-name.ngrok.app` | No `https://`. |
| `N8N_PROTOCOL` | The public protocol. | `https` | **Do not change.** Keep this as `https` for ngrok. |
| `N8N_PROXY_HOPS` | Proxy hop count. | `1` | **Do not change.** Keep this as `1` for the local ngrok stack. |

Use the same reserved ngrok domain in `NGROK_DOMAIN`, `N8N_HOST`, and `WEBHOOK_URL`.

- `NGROK_DOMAIN` has no `https://`.
- `N8N_HOST` has no `https://`.
- `WEBHOOK_URL` includes `https://` and a trailing slash.

Use a long random value for `N8N_ENCRYPTION_KEY`. Store it in a password manager. n8n needs the same key after restarts to decrypt saved credentials.

### 5.3. Check The Folder

Your local-n8n folder should look like this after `.env` exists:

```text
Desktop\n8n-local
|-- docker-compose.yml
|-- .env.example
|-- .env
|-- _n8n-local.cmd
`-- scripts\
    `-- n8n-local-menu.ps1
```

## 6. What Not To Commit

Commit means save into Git/GitHub.

Do not save these files or values into GitHub:

- `.env` files.
- Real ngrok authtokens.
- Real passwords.
- Real n8n encryption keys.
- Real API tokens, webhook secrets, or MCP tokens.
- `.n8n-local/`, `.tmp/`, backups, and live export/import files.

## 7. Start The Local Menu

### 7.1. Use The Launcher

1. Open the `n8n-local` folder on your Desktop.
2. Launch `_n8n-local.cmd`.
   - Do not launch n8n directly from Docker Desktop. Launch it from `_n8n-local.cmd` instead.
   - Docker Desktop direct launch bypasses:
      - Guided checks.
      - Selected updates.
      - Backups.
      - Clear status output.
3. Follow the menu prompts.

### 7.2. What The Menu Does

| Menu area | Use it for |
| --- | --- |
| Start | Start local n8n, Postgres, and optionally ngrok. |
| Updates | Check for newer images and apply selected updates. |
| Status | Show running containers and service health. |
| Logs | Open all logs or service-specific logs. |
| URLs | Open n8n or the ngrok inspector. |
| Backup | Create a local Postgres backup before risky changes. |

## 8. First Launch: Local-Only Owner Setup

### 8.1. Start Local n8n First To Create The Owner Account 

Create the owner account before exposing n8n through ngrok.

| File | What to do | Alternative PowerShell command |
| --- | --- | --- |
| `_n8n-local.cmd` | Choose the local start option. | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose up -d postgres n8n<br>docker compose ps |

### 8.2. Open n8n Locally

1. Open this URL in your browser: [http://localhost:5678](http://localhost:5678)
2. Create the owner account locally on first launch.
   - Do not start the public tunnel until the owner account exists.
   - The tunnel exposes the full local n8n surface reachable through that URL path, including UI, API, webhook, and MCP routes. Treat it as public access to local n8n, not as a webhook-only pipe.

## 9. Public Tunnel With ngrok

### 9.1. When Should I Use ngrok?

- If you are only opening n8n on your own computer, you do not need ngrok.
- Use ngrok when another online service must call your local n8n webhook or OAuth callback.
   - Examples:
      - Stripe webhooks.
      - GitHub webhooks.
      - Telegram webhooks.
      - OAuth callbacks.

### 9.2. You Want To Start The Public Tunnel

1. Make sure the owner account already exists.
2. Launch `_n8n-local.cmd`:

   | File | What to do | Alternative PowerShell command |
   | --- | --- | --- |
   | `_n8n-local.cmd` | Choose the ngrok / tunnel start option. | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose up -d ngrok<br>docker compose ps |

- Use the `WEBHOOK_URL` value from `.env` for external webhook and OAuth callback configuration.

### 9.4. You Want Stop The Public Tunnel While Keeping The Local n8n Instance Running

| File | What to do | Alternative PowerShell command |
| --- | --- | --- |
| `_n8n-local.cmd` | Choose the ngrok / tunnel stop option. | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose stop ngrok |

- This stops the public tunnel while leaving local n8n and Postgres running.

### 9.3. You Want To Update And Change Your Tunnel Settings

1. Restart the ngrok tunnel by closing the existing `_n8n-local.cmd` window.
2. Update `.env`.
3. Re-launch `_n8n-local.cmd`:

   | File | What to do | Alternative PowerShell command |
   | --- | --- | --- |
   | `_n8n-local.cmd` | Choose the ngrok / tunnel start option. | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose up -d --force-recreate n8n ngrok |

### 9.5. Useful URLs

| URL | Use |
| --- | --- |
| [http://localhost:5678](http://localhost:5678) | Open local n8n on your computer. |
| [http://127.0.0.1:4040](http://127.0.0.1:4040) | Open the local ngrok inspector. |
| `WEBHOOK_URL` from `.env` | Configure external webhooks and OAuth callbacks. |

Use the inspector to debug incoming tunnel requests. Do not paste secrets or real customer data into repo files while debugging.

## 10. Daily Use Of Your Instances

### 10.1. Start, Stop, Restart, Status, And Logs

Start with the menu:

1. Launch `_n8n-local.cmd` in your `n8n-local` folder.
2. Choose the action you need.

| Need | Menu action | PowerShell fallback commands
| --- | --- | --- | 
| Start local stack | Start stack | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose up -d |
| Stop containers but keep data | Stop stack | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose down |
| Restart containers | Restart stack | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose restart |
| Show status | Show status | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose logs -f |
| View logs | View logs | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose ps | 
| View n8n logs | View n8n logs | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose logs -f n8n |
| View ngrok logs | View ngrok logs | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose logs -f ngrok |
| View Postgres logs | View Postgres logs | cd "$env:USERPROFILE\OneDrive\Desktop\n8n-local"<br>docker compose logs -f postgres |

Press `Ctrl+C` to stop following logs.

### 10.2. Back Up Postgres

1. Launch `_n8n-local.cmd`.
2. Choose `Backup Postgres database`.
3. Keep the backup local and private.
   - The menu writes a timestamped SQL dump under a local `backups` folder. Do not commit backup files.

## 11. Updating Your Instances

### 11.1. Check For Updates

1. Launch `_n8n-local.cmd`..
2. Choose `Check for updates`.
   - The check compares local image tag IDs before and after `docker compose pull`. It may pull newer images into the local Docker cache, but it does not restart or recreate running services.

### 11.2. Apply Selected Updates

1. Launch `_n8n-local.cmd`.
2. Choose `Update selected services`.
3. Back up first if Postgres is selected.
   - Postgres is pinned to major version 16 in [docker-compose.yml](../../templates/local-stack/docker-compose.yml).

### 11.3. Why Updates Are Not Silent

Updating images and recreating containers are separate choices so you can:

- Back up first.
- Avoid surprise restarts.
- Update only selected services.
- Smoke test after changes.

## 12. AI Agents MCP Setup

### 12.1. Enable MCP In n8n

Inside n8n:

1. Open `Settings`.
2. Open the instance-level MCP page.
3. Enable MCP access.
4. Copy the server URL.
5. Copy the access token.
   1. For the default local stack, the local MCP URL is:

      ```text
      http://localhost:5678/mcp-server/http
      ```

   2. If you use MCP through the ngrok domain, use the MCP URL shown by n8n for that setup.
   3. Reference: [n8n MCP server docs](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/).

### 12.2. Choose Your MCP Setup Page

| Platform | Use this setup page | Use when |
| --- | --- | --- |
| Codex | [Codex MCP Setup](../ai-agent-platforms/codex.md) | You use Codex with n8n MCP. |
| Claude Code | [Claude Code MCP Setup](../ai-agent-platforms/claude-code.md) | You use Claude Code / Claude Desktop Code tab. |
| OpenCode | [OpenCode MCP Setup](../ai-agent-platforms/opencode.md) | You use OpenCode. |
| Antigravity | [Antigravity MCP Setup](../ai-agent-platforms/antigravity.md) | You use Antigravity plugin-scoped skills and MCP config. |

Restart your agent app after changing MCP config, agent rules, or user environment variables.

## 13. Troubleshooting

### 13.1. Docker Is Not Running

1. Run this in PowerShell from any folder:

   ```powershell
   docker info
   ```

2. If Docker reports that the engine is unavailable:
   1. Open Docker Desktop.
   2. Wait for the engine to finish starting.
   3. Restart `_n8n-local.cmd`.

### 13.2. `.env` Missing

1. Run this in PowerShell:

   ```powershell
   cd "$env:USERPROFILE\Desktop\n8n-local"
   Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force
   ```

2. Then open `.env`, replace the placeholders, and save the file.

### 13.3. ngrok Tunnel Not Available

1. Check `.env`:

   ```dotenv
   NGROK_AUTHTOKEN=replace-with-ngrok-authtoken
   NGROK_DOMAIN=your-reserved-domain.ngrok.app
   ```

- `NGROK_DOMAIN` should be a reserved ngrok domain without `https://`.

2. After editing `.env`:
   1. Close the existing `_n8n-local.cmd` window.
   2. Save `.env`.
   3. Restart `_n8n-local.cmd`.
   4. Start with the ngrok/tunnel option.

### 13.4. Webhook URL Still Shows Localhost

1. Check `.env`:

   ```dotenv
   WEBHOOK_URL=https://your-reserved-domain.ngrok.app/
   N8N_HOST=your-reserved-domain.ngrok.app
   N8N_PROTOCOL=https
   N8N_PROXY_HOPS=1
   ```

2. After editing `.env`:
   1. Close the existing `_n8n-local.cmd` window.
   2. Save `.env`.
   3. Restart `_n8n-local.cmd`.

3. Then refresh n8n and check the webhook node again.

### 13.5. Port 5678 Already In Use

Run this in PowerShell from any folder:

   ```powershell
   docker ps
   ```

- Another local n8n process may already be running. Stop an old local test container only if you know it is disposable.
- Do not remove Docker volumes unless you intentionally want to delete local n8n runtime data.

### 13.6. MCP Tools Do Not Appear

Check the following:
   1. MCP is enabled inside n8n.
   2. The MCP URL matches your local or ngrok setup.
   3. `N8N_MCP_TOKEN` is set in the user environment, not pasted into repo files.
   4. The agent app was fully restarted after config changes.
   5. Use docs/search MCP tools before live n8n tools. Use live n8n tools only when the user clearly asks for real instance inspection or mutation.

## 14. Advanced Queue Mode

The default local path is normal mode:

- One n8n service handles the UI, API, webhooks, scheduler, and executions.
- Postgres stores durable n8n workflow, credential, user, and execution state.

Queue mode is a future production scaling path:

- n8n main serves the UI, API, webhooks, and scheduler.
- Redis queues execution jobs.
- n8n worker containers run executions.
- Postgres stores durable workflow, credential, user, and execution state.

Do not add Redis or workers to the default local setup. Use queue mode later when production workloads need worker-based scaling.

## 15. Safety Rules

- Create the owner account locally before starting the public tunnel.
- Treat the ngrok URL as public access to local n8n UI, API, webhooks, and MCP routes.
- Do not treat ngrok as production hosting.
- Do not expose the n8n container directly to the LAN or internet.
- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, encryption keys, or MCP tokens into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
- Do not remove `n8n_data` or `postgres_data` Docker volumes unless you intentionally want to delete local runtime data.
- Keep VPS/Hostinger setup separate in [3. VPS Hosting](./vps-hosting.md).

## 16. Appendices And References

| Reference | Use when |
| --- | --- |
| [2. Upgrading](upgrading.md) | You need focused update notes for local, VPS, or npm installs. |
| [3. VPS Hosting](./vps-hosting.md) | You need always-on public hosting on Hostinger. |
