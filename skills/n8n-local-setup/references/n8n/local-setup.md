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
* Optional AI-coding-agent MCP feature references are secondary. Do not start there.
* Do not paste real tokens, credentials, `.env` values, backups, or live exports into repo files.

---

## 1. Fast Path ( Full Guide Below )

| Step | What to do | Where | Result |
| --- | --- | --- | --- |
| 1. | Install Docker Desktop. | Your Windows computer. | Docker Compose is available. |
| 2. | Create the local stack folder at `%USERPROFILE%\.n8n-local`. | Windows Explorer. | Local runtime files stay outside this repo and outside OneDrive Desktop. |
| 3. | Copy everything inside [templates/local-stack/](../../templates/local-stack/) into your local stack folder. | Toolkit repo or copied skill folder. | The folder has Compose, `.env.example`, `_n8n-local.cmd`, and `scripts\`. |
| 4. | Copy `.env.example` to `.env`. | `<LOCAL_STACK_FOLDER>`. | You have a private local settings file. |
| 5. | Fill only local runtime values first. | `.env`. | Local n8n and Postgres can start. |
| 6. | Optional: copy `n8n-local-desktop-shortcut.cmd` to your Desktop. | Desktop. | You get a convenient button without putting the runtime folder on the Desktop. |
| 7. | Double-click `_n8n-local.cmd`, or double-click the Desktop shortcut if you copied it. | `<LOCAL_STACK_FOLDER>` or Desktop. | The guided menu opens and stays open after actions. |
| 8. | Choose `Start n8n`, then `Localhost only`. | Menu. | n8n starts locally without public exposure. |
| 9. | Open a web browser and go to `http://localhost:5678`, then create the owner account. | Browser. | Local n8n works before any public URL setup. |
| 10. | Add ngrok only if something outside your computer must reach n8n. | Compose ngrok service. | You get a public URL for webhooks or OAuth callbacks. |

Do not save `.env`, tokens, backups, `.n8n-local/`, `.tmp/`, credentials, runtime payloads, or live n8n imports/exports into GitHub.

---

## 2. Before You Start

Do not ask for ngrok or public URL values before local n8n works. The order is:

1. Start local n8n.
2. Create the owner account at `http://localhost:5678`.
3. Confirm local n8n works in a web browser.
4. Add a public ngrok URL only if needed.

| Need | Install or open | Quick check |
| --- | --- | --- |
| Docker runtime | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Docker Desktop says the engine is running. |
| Local stack folder | `%USERPROFILE%\.n8n-local`. | It is outside this repo, outside Git tracking, and not on OneDrive Desktop by default. |
| ngrok account | [ngrok dashboard](https://dashboard.ngrok.com) | Needed only when you need a public tunnel. |

Run these checks in PowerShell from any folder:

```powershell
docker --version
docker compose version
```

If Docker is installed but not running, open Docker Desktop and wait until the engine is ready.

---

## 3. Create The Local Stack Folder

Use this default folder:

```text
%USERPROFILE%\.n8n-local
```

Example:

```text
C:\Users\<your-user>\.n8n-local
```

Why this folder:

- It is inside your Windows user profile.
- It is outside this toolkit repo.
- It is normally outside OneDrive Desktop sync.
- It keeps `.env` and local backups away from your visible Desktop.

Do not put the real runtime folder on OneDrive Desktop unless you intentionally want `.env` and backups to sync to OneDrive.

If you want a Desktop button, use the Desktop shortcut CMD later. Keep the real stack folder at `%USERPROFILE%\.n8n-local`.

Other acceptable choices:

| Location | Use when |
| --- | --- |
| `C:\.n8n-local` | Good if you want a short machine-level path. |
| `C:\Users\<you>\Documents\.n8n-local` | OK if Documents is not synced to OneDrive. |
| Desktop | Not recommended for the runtime folder. Use the Desktop shortcut instead. |

OneDrive Desktop redirection can make local `.env` files and backups sync unexpectedly. If your Desktop path contains `OneDrive`, keep the stack folder at `%USERPROFILE%\.n8n-local` and put only the shortcut CMD on the Desktop.

This guide uses `<LOCAL_STACK_FOLDER>` as a placeholder. Replace it with your chosen folder path.

1. Create the folder in Windows Explorer.
2. Keep it outside this toolkit repo.
3. Do not put `.env`, backups, Docker volumes, private setup notes, or runtime data in a GitHub-tracked folder.

PowerShell fallback:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.n8n-local"
```

---

## 4. Copy The Local Stack Templates

The local stack template folder is [templates/local-stack/](../../templates/local-stack/).

| File or folder | Link |
| --- | --- |
| Docker Compose template | [docker-compose.yml](../../templates/local-stack/docker-compose.yml) |
| Environment template | [.env.example](../../templates/local-stack/.env.example) |
| Windows launcher | [_n8n-local.cmd](../../templates/local-stack/_n8n-local.cmd) |
| Desktop shortcut launcher | [n8n-local-desktop-shortcut.cmd](../../templates/local-stack/n8n-local-desktop-shortcut.cmd) |
| Menu script | [n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1) |

1. Open [templates/local-stack/](../../templates/local-stack/).
2. Select everything inside that folder.
3. Copy the selected files and folders.
4. Paste them into `<LOCAL_STACK_FOLDER>`.
5. Keep `docker-compose.yml`, `.env.example`, `_n8n-local.cmd`, `n8n-local-desktop-shortcut.cmd`, and `scripts\` together.
6. Optional: copy `n8n-local-desktop-shortcut.cmd` to your Desktop after the real stack folder is ready.

PowerShell fallback from the toolkit repo root:

```powershell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
New-Item -ItemType Directory -Force "$env:USERPROFILE\.n8n-local"
Copy-Item -LiteralPath "_projects\n8n\local-setup\_main\templates\local-stack\*" -Destination "$env:USERPROFILE\.n8n-local" -Recurse -Force
Copy-Item -LiteralPath "$env:USERPROFILE\.n8n-local\n8n-local-desktop-shortcut.cmd" -Destination (Join-Path $DesktopPath 'n8n-local-desktop-shortcut.cmd') -Force
```

`$DesktopPath` uses your real Windows Desktop folder. On many computers this is `C:\Users\<you>\OneDrive\Desktop`; on others it is `C:\Users\<you>\Desktop`.

The copied folder should look like this:

```text
<LOCAL_STACK_FOLDER>
|-- docker-compose.yml
|-- .env.example
|-- _n8n-local.cmd
|-- n8n-local-desktop-shortcut.cmd
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
cd "$env:USERPROFILE\.n8n-local"
Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force
```

Replace only the value after `=`. Do not add quotes unless the value itself requires them.

Some `.env` values are copied from somewhere else. Some are values you make up yourself.

Use this rule:

- If the guide says the value comes from a dashboard, domain, URL, or service, copy the real value from there.
- If the guide says local password, random value, or random key, you are allowed to invent any strong random value yourself.
- Do not use the example placeholder text as the final value.
- Do not paste angle brackets like `<paste-token-here>` into `.env`.

### STEP 1: Fill These Before First Launch

Fill these before starting n8n for the first time:

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | A local database password. | `replace-with-local-postgres-password` becomes a private password. | You make this up. Store it in a password manager. |
| `N8N_ENCRYPTION_KEY` | A long random value. | 32+ random characters. | You make this up once, then keep it forever for this stack. n8n needs the same key after restarts to decrypt saved credentials. |
| `TZ` | Your local timezone. | `Asia/Singapore` | This is a predefined timezone name. Keep or change intentionally. |
| `GENERIC_TIMEZONE` | Your local timezone. | `Asia/Singapore` | This is a predefined timezone name. Keep aligned with `TZ`. |

For `POSTGRES_PASSWORD`, choose any strong random password. It does not come from Docker, n8n, ngrok, or Hostinger.

For `N8N_ENCRYPTION_KEY`, choose any long random value. It does not come from n8n. After you use it, do not change it unless you understand the consequences.

### STEP 2: Keep These Local Defaults For First Launch

Leave these as-is until local n8n works in your browser:

| Variable | First-launch value | Notes |
| --- | --- | --- |
| `N8N_HOST` | `localhost` | Type exactly `localhost`. This is only the host name. Do not put `http://` here. Do not put your ngrok domain here. |
| `N8N_LOCAL_PORT` | `5678` | This is the browser port on your computer. If `http://localhost:5678` is already used, change this to an unused port such as `5679`. |
| `N8N_PROTOCOL` | `http` | Type exactly `http` for this local Docker setup. Do not change this to `https` for ngrok. |
| `WEBHOOK_URL` | `http://localhost:5678/` | This is the full local webhook base URL. Keep the trailing slash. If you changed `N8N_LOCAL_PORT` to `5679`, set this to `http://localhost:5679/`. |
| `N8N_PROXY_HOPS` | `1` | Keep this as `1` for the local setup. |
| `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS` | `true` | Leave this alone. |
| `N8N_RUNNERS_ENABLED` | `true` | Leave this alone. |

For this guide, keep `N8N_HOST=localhost`.

What that means:

- For local-only use, open n8n in your browser at `http://localhost:5678`.
- If port `5678` is already used, change `N8N_LOCAL_PORT` to another unused port such as `5679`, then open `http://localhost:5679`.
- When you add ngrok, do not change `N8N_HOST`.
- For ngrok, the value you change is `WEBHOOK_URL`, not `N8N_HOST`.
- Advanced reverse-proxy or custom-domain hosting may use different host settings, but that is outside this local setup guide.

### STEP 3: Fill These Later Only After Local n8n Works

Use these only when you are ready to expose local n8n through the Compose ngrok service:

You get these values from your ngrok account:

1. Open the ngrok Docker setup page: [https://dashboard.ngrok.com/get-started/setup/docker](https://dashboard.ngrok.com/get-started/setup/docker).
2. This is the ngrok dashboard page for Docker. It is not Docker Desktop.
3. On that page, find the authtoken shown in section 1.
4. Copy the authtoken into `NGROK_AUTHTOKEN`.
5. On that same Docker setup page, look near the bottom of section 1 for the free ngrok domain.
6. Copy only the hostname into `NGROK_DOMAIN`.
7. Build `WEBHOOK_URL` from that domain.

If ngrok shows this domain:

```text
your-name.ngrok.app
```

Then use these two `.env` values:

```text
NGROK_DOMAIN=your-name.ngrok.app
WEBHOOK_URL=https://your-name.ngrok.app/
```

Notice the difference:

- `NGROK_DOMAIN` is only the hostname. No `https://`. No trailing slash.
- `WEBHOOK_URL` is the full URL. It includes `https://` and the trailing slash.

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `WEBHOOK_URL` | The full URL made from your ngrok domain. | `https://your-name.ngrok.app/` | Include `https://` and the trailing slash. |
| `NGROK_AUTHTOKEN` | Your ngrok authtoken. | Value from section 1 of the ngrok Docker setup page. | Copy this from ngrok. Do not make this up. |
| `NGROK_DOMAIN` | The free domain shown by ngrok. | `your-name.ngrok.app` | Copy this from the bottom of section 1 on the ngrok Docker setup page. Do not include `https://`. |

For ngrok in this guide, still keep:

```text
N8N_HOST=localhost
N8N_PROTOCOL=http
```

Do not put your ngrok domain into `N8N_HOST`. The launcher checks for this because putting the ngrok domain in the wrong field is an easy mistake.

### If Port 5678 Is Already Used

If `http://localhost:5678` does not open because another app is already using port `5678`, use a different local browser port.

Use this simple option:

1. Open `<LOCAL_STACK_FOLDER>\.env`.
2. Change `N8N_LOCAL_PORT=5678` to an unused port, for example:

   ```text
   N8N_LOCAL_PORT=5679
   ```

3. For local-only use, change `WEBHOOK_URL` to match:

   ```text
   WEBHOOK_URL=http://localhost:5679/
   ```

4. Start n8n from `_n8n-local.cmd`.
5. Open a web browser.
6. In the browser address bar, go to:

   ```text
   http://localhost:5679
   ```

Do not change `N8N_HOST`. Do not change Docker's internal `5678` port. The `N8N_LOCAL_PORT` value changes only the port on your computer.

## 6. First-Time Local n8n Setup

1. Open `<LOCAL_STACK_FOLDER>`.
2. Double-click `_n8n-local.cmd`.
3. Do not launch n8n directly from Docker Desktop. Launch it from `_n8n-local.cmd` instead because the launcher shows status, checks for missing files, keeps update choices guided, and gives you backup/log/help options.
4. Choose `Start n8n`, then `Localhost only`.
5. Open a web browser.
6. In the browser address bar, go to:

   ```text
   http://localhost:5678
   ```

7. Do not type this into PowerShell or CMD. It is a browser address.
8. Create the owner account locally.
9. Confirm the editor loads and a workflow can be saved.

Docker Desktop's direct start button skips the launcher menu. Use it only if you already understand the raw Docker Compose setup.

PowerShell fallback:

```powershell
cd "$env:USERPROFILE\.n8n-local"
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

### Compose ngrok Service

This guide uses the `ngrok` service in `docker-compose.yml`. Do not install a separate ngrok extension for this guide.

What happens:

1. Docker starts the local n8n container.
2. Docker starts the ngrok container.
3. ngrok connects to `n8n:5678` inside the same Docker Compose network.
4. ngrok gives the internet a public HTTPS URL.
5. n8n still runs on your computer, but external services can reach it through the ngrok URL.

Before you start:

1. Create or sign in to an ngrok account.
2. Open the ngrok Docker setup page: [https://dashboard.ngrok.com/get-started/setup/docker](https://dashboard.ngrok.com/get-started/setup/docker).
3. This is the ngrok dashboard page for Docker. It is not Docker Desktop.
4. In section 1, copy the authtoken into `NGROK_AUTHTOKEN` in `.env`.
5. Near the bottom of section 1, find the free ngrok domain shown for the Docker command.
6. Copy only the hostname into `NGROK_DOMAIN`.

Example:

```text
NGROK_DOMAIN=your-name.ngrok.app
```

Do not include `https://` in `NGROK_DOMAIN`.

Then set `WEBHOOK_URL` to the full public URL:

```text
WEBHOOK_URL=https://your-name.ngrok.app/
```

Include `https://` and the trailing slash in `WEBHOOK_URL`.

Keep these local defaults for ngrok in this guide:

```text
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_PROXY_HOPS=1
```

If you changed `N8N_LOCAL_PORT` earlier, you can leave it alone. ngrok still reaches n8n inside Docker at `n8n:5678`.

Start the tunnel from the menu:

1. Double-click `_n8n-local.cmd`.
2. Choose `Start n8n`.
3. Choose `Start ngrok tunnel`.
4. Return to the main menu after the action finishes.
5. Read the quick status at the top of the main menu and confirm `ngrok: running`.
6. If you need deeper troubleshooting details, choose `Show Compose status` to see service state, health, container names, and ports.
7. Choose `View logs`.
8. When the logs menu asks for a choice, enter `ngrok`.
9. Look for the public forwarding URL.

PowerShell fallback:

```powershell
cd "$env:USERPROFILE\.n8n-local"
docker compose up -d ngrok
docker compose logs --tail 200 ngrok
```

After changing `WEBHOOK_URL`, recreate n8n so it reads the new `.env` value:

```powershell
cd "$env:USERPROFILE\.n8n-local"
docker compose up -d --force-recreate n8n ngrok
```

Free ngrok accounts get an assigned Dev Domain. For this guide, use the free domain shown on the ngrok Docker setup page unless you already know you have a paid or custom ngrok domain.

Stopping the `ngrok` Docker service stops the tunnel. It does not delete or release a reserved ngrok domain.

---

## 8. `_n8n-local.cmd` Guide

Open `<LOCAL_STACK_FOLDER>`, double-click `_n8n-local.cmd`, then read the status at the top of the menu before choosing an action.

If you copied `n8n-local-desktop-shortcut.cmd` to your Desktop, you can double-click that instead. It opens the launcher from `%USERPROFILE%\.n8n-local`.

When an action finishes, press `Enter` at the prompt. The launcher clears the completed command output, trims the console buffer when Windows allows it, and redraws the main menu. The CMD window should not grow forever during normal menu use.

The menu shows quick status for:

```text
postgres: running or stopped
n8n: running or stopped
ngrok: running or stopped
```

Read it like this:

- `n8n: running` means the local editor should open in a web browser at the local port from `.env`, usually `http://localhost:5678`.
- `ngrok: running` means the public tunnel is on.
- `ngrok: stopped` means the public tunnel is off.

### 8.1 First Screen

| Number | Command | Use when | Opens another menu? |
| --- | --- | --- | --- |
| 1 | `Start n8n` | You want to start local n8n, with or without ngrok. | Yes. |
| 2 | `Restart n8n` | n8n is acting weird and you want to restart only the n8n app container. | No. |
| 3 | `Stop n8n` | You want to stop ngrok only, or stop the full local stack. | Yes. |
| 4 | `Update` | You want to check and apply Docker image updates. | Yes. |
| 5 | `Show Compose status` | You need deeper troubleshooting details: service state, health, container names, and ports. | No. |
| 6 | `View logs` | You want to inspect all logs or one service's logs. | Yes. |
| 7 | `Back up` | You want a local Postgres SQL backup. | No. |
| 8 | `Command list` | You want a plain explanation of what each menu command does. | No. |
| 9 | `Exit` | You want to close the launcher cleanly. | No. |

For normal use, the quick status at the top of the main menu is enough. Use `Show Compose status` only when you need the more detailed Docker Compose view.

### 8.2 `Start n8n` Menu

Choose one:

| Choice | Use when | What it does |
| --- | --- | --- |
| `Localhost only` | You only need n8n on your own computer. | Starts Postgres and n8n. If ngrok is running, it stops ngrok so the setup is localhost-only. |
| `Start ngrok tunnel` | A webhook, OAuth callback, or remote agent needs a public URL. | Starts n8n if needed. If n8n is already running, it says so, then starts ngrok if ngrok is not running. |
| `Update all, then start with ngrok tunnel` | You want to update first, then run with public access. | Opens the update flow first. After updates, it starts n8n and ngrok. |

For localhost-only use, open a web browser and go to:

```text
http://localhost:5678
```

For ngrok use, fill `WEBHOOK_URL`, `NGROK_AUTHTOKEN`, and `NGROK_DOMAIN` in `.env` before starting the tunnel.

### 8.3 `Stop n8n` Menu

Choose one:

| Choice | Use when | What it does |
| --- | --- | --- |
| `Stop ngrok tunnel` | You want n8n to stay local, but public access should turn off. | Stops only the `ngrok` service. |
| `n8n + ngrok tunnel` | You are done working for now. | Runs `docker compose down`, which stops n8n, Postgres, and ngrok without deleting Docker volumes. |

Stopping ngrok does not delete or release your reserved ngrok domain.

### 8.4 `Update` Menu

The update menu always checks for updates before it lets you choose what to update.

What the check does:

1. Pulls current Docker image metadata.
2. Compares local image IDs before and after the pull.
3. Reports which services appear to have updates.
4. Does not recreate running containers until you choose an update option.

After the check, choose one:

| Choice | What it updates | Notes |
| --- | --- | --- |
| `All services` | `n8n`, `postgres`, and `ngrok`. | Because this includes Postgres, the launcher runs `Back up` first and stops the update if backup fails. |
| `n8n only` | n8n app container. | Common update choice. |
| `postgres only` | Postgres container. | The launcher runs `Back up` first and stops the update if backup fails. Postgres is pinned to major version 16. |
| `ngrok only` | ngrok tunnel container. | Safe when only tunnel image updates are available. |
| `Cancel` | Nothing. | Returns to the menu. |

If the update includes Postgres, the launcher runs `Back up` first. The backup file goes into:

```text
%USERPROFILE%\.n8n-local\backups
```

Local update notes:

- n8n updates come from `docker.n8n.io/n8nio/n8n:stable`.
- Postgres is pinned to major version 16 in [docker-compose.yml](../../templates/local-stack/docker-compose.yml).
- The Compose ngrok service uses `ngrok/ngrok:latest`.
- Local stack template/script updates come from this toolkit repo. Re-copy templates only after reviewing what changed.

### 8.5 `View logs` Menu

Choose one:

| Choice | Use when |
| --- | --- |
| `all` | You are not sure which service is failing. |
| `n8n` | The editor, workflows, or webhooks are failing. |
| `postgres` | n8n cannot connect to the database. |
| `ngrok` | The public tunnel is not working. |
| `cancel` | You do not want logs. |

Logs show the last 200 lines and then return to the menu prompt. This keeps the CMD window from growing forever during normal use.

### 8.6 `Back up` And `Command list`

`Back up` writes a timestamped SQL dump under:

```text
%USERPROFILE%\.n8n-local\backups
```

Keep that folder local and private.

`Command list` explains what the numbered menu options do. It is not asking you to type Docker commands for normal use.

---

## 9. Skills-First Agent Guidance

This toolkit is skills-first.

* Humans use `_projects/**` for source review and maintenance.
* Agents use `skills/**` after generated outputs are synced.
* Optional AI-coding-agent MCP feature references are available as secondary material, not as the beginner setup path.
* Use [n8n Agent Rules](../../../n8n-agent-rules/) before workflow, helper-script, import/export, credential, execution, repo/live sync, or live-instance work.

Use this table only when you want an AI coding agent to work with n8n workflows through the optional MCP feature setup:

| Platform | Setup guide | Config template |
| --- | --- | --- |
| Codex | [mcp setup - codex.md](../../../../skills/n8n-local-setup/references/ai-agent-platforms/codex.md) | [codex-mcp-config.md](../../../../skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md) |
| Claude Code | [mcp setup - claude code.md](../../../../skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md) | [claude-mcp-config.md](../../../../skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md) |
| OpenCode | [mcp setup - opencode.md](../../../../skills/n8n-local-setup/references/ai-agent-platforms/opencode.md) | [opencode-mcp-config.md](../../../../skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md) |
| Antigravity | [mcp setup - antigravity.md](../../../../skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md) | [antigravity-mcp-config.md](../../../../skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md) |

---

## 10. Troubleshooting

### Docker Is Not Running

1. Open Docker Desktop.
2. Wait for the engine to finish starting.
3. Relaunch `_n8n-local.cmd`.
4. Read the quick status at the top of the main menu.
5. If you need ports or health details, choose `Show Compose status`.

### `.env` Is Missing

1. Copy `.env.example` to `.env`.
2. Replace only local runtime placeholders first.
3. Relaunch `_n8n-local.cmd`.

### Webhook URLs Still Show Localhost

1. Confirm local n8n works first.
2. Confirm your public endpoint works.
3. Set `WEBHOOK_URL`, `NGROK_AUTHTOKEN`, and `NGROK_DOMAIN` intentionally.
4. Recreate n8n from the menu with `Update`, then `n8n only`, or with a fallback command.

### Port 5678 Is Already In Use

Another app may already be using `http://localhost:5678`.

Beginner-safe fix:

1. Open `<LOCAL_STACK_FOLDER>\.env`.
2. Change `N8N_LOCAL_PORT=5678` to another unused port, such as `5679`.
3. Change `WEBHOOK_URL=http://localhost:5678/` to `WEBHOOK_URL=http://localhost:5679/`.
4. Relaunch `_n8n-local.cmd`.
5. Open a web browser.
6. Go to `http://localhost:5679`.

Do not change `N8N_HOST`. Do not change the right-side Docker port `5678` in `docker-compose.yml`.

If you already have an old disposable n8n container running, stop it only if you know it is not needed.

Do not delete Docker volumes unless you intentionally want to delete local n8n runtime data.

---

## 11. Advanced Queue Mode

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

## 12. Safety Rules

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

## 13. Appendices And References

| Reference | Use when |
| --- | --- |
| [Page 2 - Hostinger VPS](hostinger-vps.md) | You need always-on public hosting on Hostinger. |
| [Local stack templates](../../templates/local-stack/) | You need the Docker Compose, environment template, launcher, and menu script. |
| [n8n Agent Rules](../../../n8n-agent-rules/) | You need the full n8n operating rules before workflow/live n8n work. |
