# Page 1 - Local Setup

This is the beginner path for running n8n locally on Windows with Docker Desktop, Postgres, the guided `_n8n-local.cmd` menu, and optional ngrok public access.

Use [Page 2 - Hostinger VPS](./Page%202%20-%20Hostinger%20VPS.md) instead when you want an always-on hosted server.

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
| 3. | Copy everything inside [templates/local-stack/](./templates/local-stack/) into your local stack folder. | Toolkit repo or copied skill folder. | The folder has Compose, `.env.example`, `_n8n-local.cmd`, and `scripts\`. |
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
C:\Users\xPass\.n8n-local
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
| `C:\n8n-local` | Good if you want a short machine-level path. |
| `C:\Users\<you>\Documents\n8n-local` | OK if Documents is not synced to OneDrive. |
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

The local stack template folder is [templates/local-stack/](./templates/local-stack/).

| File or folder | Link |
| --- | --- |
| Docker Compose template | [docker-compose.yml](./templates/local-stack/docker-compose.yml) |
| Environment template | [.env.example](./templates/local-stack/.env.example) |
| Windows launcher | [_n8n-local.cmd](./templates/local-stack/_n8n-local.cmd) |
| Desktop shortcut launcher | [n8n-local-desktop-shortcut.cmd](./templates/local-stack/n8n-local-desktop-shortcut.cmd) |
| Menu script | [n8n-local-menu.ps1](./templates/local-stack/scripts/n8n-local-menu.ps1) |

1. Open [templates/local-stack/](./templates/local-stack/).
2. Select everything inside that folder.
3. Copy the selected files and folders.
4. Paste them into `<LOCAL_STACK_FOLDER>`.
5. Keep `docker-compose.yml`, `.env.example`, `_n8n-local.cmd`, `n8n-local-desktop-shortcut.cmd`, and `scripts\` together.
6. Optional: copy `n8n-local-desktop-shortcut.cmd` to your Desktop after the real stack folder is ready.

PowerShell fallback from the toolkit repo root:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.n8n-local"
Copy-Item -LiteralPath "_projects\n8n\local-setup\_main\templates\local-stack\*" -Destination "$env:USERPROFILE\.n8n-local" -Recurse -Force
Copy-Item -LiteralPath "$env:USERPROFILE\.n8n-local\n8n-local-desktop-shortcut.cmd" -Destination "$env:USERPROFILE\Desktop\n8n-local-desktop-shortcut.cmd" -Force
```

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
| `N8N_HOST` | `localhost` | This is only the host name. It is not a URL. Do not put `http://` here. |
| `N8N_PROTOCOL` | `http` | Local-only first launch uses `http`. |
| `WEBHOOK_URL` | `http://localhost:5678/` | This is the full local webhook base URL. Keep the trailing slash. |
| `N8N_PROXY_HOPS` | `1` | Keep this as `1` for the local setup. |
| `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS` | `true` | Leave this alone. |
| `N8N_RUNNERS_ENABLED` | `true` | Leave this alone. |

`N8N_HOST` can stay `localhost` for this guide. When you add ngrok, the main value you change is `WEBHOOK_URL`.

### STEP 3: Fill These Later Only After Local n8n Works

Use these only when you are ready to expose local n8n through the Compose ngrok service:

| Variable | What to paste | Example / format | Notes |
| --- | --- | --- | --- |
| `WEBHOOK_URL` | Your reserved ngrok URL. | `https://your-name.ngrok.app/` | Copy this from ngrok. Include `https://` and the trailing slash. |
| `NGROK_AUTHTOKEN` | Your ngrok authtoken. | Value from ngrok dashboard. | Copy this from ngrok. Do not make this up. |
| `NGROK_DOMAIN` | Your reserved ngrok domain. | `your-name.ngrok.app` | Copy this from ngrok. Do not include `https://`. |

Keep `N8N_HOST=localhost` unless you intentionally know why you need to change it.

## 6. First-Time Local n8n Setup

1. Open `<LOCAL_STACK_FOLDER>`.
2. Double-click `_n8n-local.cmd`.
3. Do not launch n8n directly from Docker Desktop. Launch it from `_n8n-local.cmd` instead.
4. Choose `Start n8n`, then `Localhost only`.
5. Open a web browser.
6. In the browser address bar, go to:

   ```text
   http://localhost:5678
   ```

7. Do not type this into PowerShell or CMD. It is a browser address.
8. Create the owner account locally.
9. Confirm the editor loads and a workflow can be saved.

Docker Desktop direct launch bypasses guided checks, selected updates, backups, and clear status output.

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

1. Create or sign in to an ngrok account at [https://dashboard.ngrok.com](https://dashboard.ngrok.com).
2. In ngrok, find your authtoken.
3. Copy the authtoken into `NGROK_AUTHTOKEN` in `.env`.
4. In ngrok, reserve or choose a domain.
5. Copy only the hostname into `NGROK_DOMAIN`.

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

Keep these local defaults unless you intentionally know why you are changing them:

```text
N8N_HOST=localhost
N8N_PROTOCOL=http
N8N_PROXY_HOPS=1
```

Start the tunnel from the menu:

1. Double-click `_n8n-local.cmd`.
2. Choose `Start n8n`.
3. Choose `Start ngrok tunnel`.
4. Choose `Show Compose status`.
5. Confirm `ngrok` is running.
6. Choose `View logs`, then type `ngrok`.
7. Look for the public forwarding URL.

PowerShell fallback:

```powershell
cd "$env:USERPROFILE\.n8n-local"
docker compose up -d ngrok
docker compose logs -f ngrok
```

After changing `WEBHOOK_URL`, recreate n8n so it reads the new `.env` value:

```powershell
cd "$env:USERPROFILE\.n8n-local"
docker compose up -d --force-recreate n8n ngrok
```

Free ngrok accounts get an assigned Dev Domain. Reserving custom domain names can require a paid plan. Bring-your-own-domain setup requires DNS/CNAME configuration in the domain's DNS provider.

Stopping the `ngrok` Docker service stops the tunnel. It does not delete or release a reserved ngrok domain.

---

## 8. `_n8n-local.cmd` Guide

Open `<LOCAL_STACK_FOLDER>`, double-click `_n8n-local.cmd`, then read the status at the top of the menu before choosing an action.

If you copied `n8n-local-desktop-shortcut.cmd` to your Desktop, you can double-click that instead. It opens the launcher from `%USERPROFILE%\.n8n-local`.

The menu shows quick status for:

```text
postgres: running or stopped
n8n: running or stopped
ngrok: running or stopped
```

Read it like this:

- `n8n: running` means the local editor should open in a web browser at `http://localhost:5678`.
- `ngrok: running` means the public tunnel is on.
- `ngrok: stopped` means the public tunnel is off.

### 8.1 First Screen

| Number | Command | Use when | Opens another menu? |
| --- | --- | --- | --- |
| 1 | `Start n8n` | You want to start local n8n, with or without ngrok. | Yes. |
| 2 | `Restart n8n` | n8n is acting weird and you want to restart only the n8n app container. | No. |
| 3 | `Stop n8n` | You want to stop ngrok only, or stop the full local stack. | Yes. |
| 4 | `Update` | You want to check and apply Docker image updates. | Yes. |
| 5 | `Show Compose status` | You want to see all available Compose services and their status. | No. |
| 6 | `View logs` | You want to inspect all logs or one service's logs. | Yes. |
| 7 | `Back up` | You want a local Postgres SQL backup. | No. |
| 8 | `Help` | You want the command reference. | No. |
| 9 | `Exit` | You want to close the launcher cleanly. | No. |

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
| `All services` | `n8n`, `postgres`, and `ngrok`. | Back up first if you care about the current database state. |
| `n8n only` | n8n app container. | Common update choice. |
| `postgres only` | Postgres container. | The menu asks for confirmation first. Postgres is pinned to major version 16. |
| `ngrok only` | ngrok tunnel container. | Safe when only tunnel image updates are available. |
| `Cancel` | Nothing. | Returns to the menu. |

Local update notes:

- n8n updates come from `docker.n8n.io/n8nio/n8n:stable`.
- Postgres is pinned to major version 16 in [docker-compose.yml](./templates/local-stack/docker-compose.yml).
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

Logs follow live. Press `Ctrl+C` to stop following logs and return to the menu prompt.

### 8.6 `Back up` And `Help`

`Back up` writes a timestamped SQL dump under a local `backups` folder. Keep that folder local and private.

`Help` shows the raw Docker commands behind the menu.

---

## 9. Skills-First Agent Guidance

This toolkit is skills-first.

* Humans use `_projects/**` for source review and maintenance.
* Agents use `skills/**` after generated outputs are synced.
* Optional AI-coding-agent MCP feature references are available as secondary material, not as the beginner setup path.
* Use [n8n Agent Rules](../../../../skills/n8n-agent-rules/) before workflow, helper-script, import/export, credential, execution, repo/live sync, or live-instance work.

---

## 10. Troubleshooting

### Docker Is Not Running

1. Open Docker Desktop.
2. Wait for the engine to finish starting.
3. Relaunch `_n8n-local.cmd`.
4. Choose `Show Compose status`.

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

Another local n8n process may already be running. Stop old disposable test containers only if you know they are not needed.

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
- Use [Page 2 - Hostinger VPS](./Page%202%20-%20Hostinger%20VPS.md) for always-on hosted setup.

---

## 13. Appendices And References

| Reference | Use when |
| --- | --- |
| [Page 2 - Hostinger VPS](./Page%202%20-%20Hostinger%20VPS.md) | You need always-on public hosting on Hostinger. |
| [Local stack templates](./templates/local-stack/) | You need the Docker Compose, environment template, launcher, and menu script. |
| [n8n Agent Rules](../../../../skills/n8n-agent-rules/) | You need the full n8n operating rules before workflow/live n8n work. |
