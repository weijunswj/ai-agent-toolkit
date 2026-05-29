<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/3a. docker compose + ngrok.md
Update the project source and run sync.
-->
# 3a. Compose Template Reference

The primary setup guide is [1. Local Setup](local-setup.md). This page explains the local stack templates; it is not a separate start path.

## Template Folder

Copy everything inside [templates/local-stack/](../../templates/local-stack/) into `Desktop\n8n-local`.

| Template | Purpose |
| --- | --- |
| [docker-compose.yml](../../templates/local-stack/docker-compose.yml) | Runs n8n, Postgres, and ngrok. |
| [.env.example](../../templates/local-stack/.env.example) | Placeholder-only local settings template. |
| [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd) | Windows launcher for the guided menu. |
| [scripts/n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1) | PowerShell menu behind the launcher. |

Do not copy only one script. Keep the whole template folder contents together.

## Stack Shape

| Service | Why it exists |
| --- | --- |
| `n8n` | Runs the local n8n UI, API, webhooks, scheduler, and executions. |
| `postgres` | Stores n8n workflow, credential, user, and execution state. |
| `ngrok` | Provides the supported local public tunnel when outside services must call local n8n. |
| `n8n_data` | Keeps n8n runtime data between container restarts. |
| `postgres_data` | Keeps Postgres data between container restarts. |

The local Postgres service is only n8n's internal runtime database. It is not Vercel, it is not Supabase, and it must not connect to the user's app database.

## Why Postgres Is Included

Postgres is included because it keeps local development closer to serious n8n deployments.

| Choice | Reason |
| --- | --- |
| Postgres | Better production parity and clearer future queue-mode path. |
| SQLite | Simpler for throwaway testing, but not the default in this toolkit stack. |

## `docker-compose.yml`

The template source is [templates/local-stack/docker-compose.yml](../../templates/local-stack/docker-compose.yml).

Important details:

1. `postgres` uses `postgres:16-alpine`.
2. `n8n` uses `docker.n8n.io/n8nio/n8n:stable`.
3. `ngrok` uses `ngrok/ngrok:latest`.
4. n8n waits for Postgres to become healthy.
5. n8n binds to `127.0.0.1:5678` on the host.
6. The ngrok inspector binds to `127.0.0.1:4040` on the host.
7. Redis and worker services are intentionally not part of the default local setup.

## `.env.example`

The template source is [templates/local-stack/.env.example](../../templates/local-stack/.env.example).

| Variable group | Values |
| --- | --- |
| n8n internal database | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| n8n runtime | `N8N_ENCRYPTION_KEY`, `N8N_HOST`, `N8N_PROTOCOL`, `WEBHOOK_URL`, `N8N_PROXY_HOPS`, `TZ`, `GENERIC_TIMEZONE`, `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS`, `N8N_RUNNERS_ENABLED` |
| ngrok | `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` |

All values are placeholders. Replace them only in the local `.env` file, never in repo templates.

## Launcher

Use [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd) for normal local stack control.

The launcher opens [scripts/n8n-local-menu.ps1](../../templates/local-stack/scripts/n8n-local-menu.ps1), which provides:

- Start, stop, restart, and status actions.
- Update checks and selected updates.
- Logs and URL shortcuts.
- Postgres backup action.
- File and Docker readiness checks.

Do not launch n8n directly from Docker Desktop. Launch it from `n8n-local.cmd` instead.

Docker Desktop direct launch bypasses guided checks, selected updates, backups, and clear status output.

## Advanced Queue Mode

Normal mode is the default local setup. One n8n service handles the UI, API, webhooks, scheduler, and executions.

Queue mode is a future production scaling path:

- n8n main serves the UI, API, webhooks, and scheduler.
- Redis queues jobs.
- n8n worker containers run executions.
- Postgres stores durable workflow and execution state.

Do not add Redis or workers to the default local setup.

## Safety Notes

- Do not save `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, backups, or live n8n import/export files into GitHub.
- Do not remove `n8n_data` or `postgres_data` unless you intentionally want to delete local runtime data.
- Do not treat ngrok as permanent production hosting.
