<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/templates/production-server-backups/README.md
Update the project source and run sync.
-->
# Production n8n Server Backups

Use this template for Linux server deployments such as Hostinger VPS plus Coolify, or another company server running n8n with Docker Compose.

This is separate from the Windows local launcher backup flow. Do not use Windows Task Scheduler for server backups.

## What It Backs Up

`n8n-production-backup.sh.template` is the inert repository template. Copy it to the server as `n8n-production-backup.sh`; the installed script creates one timestamped folder per run:

```text
<backup-root>/
`-- n8n-production-YYYYMMDD-HHMMSS/
    |-- workflows/
    |-- credentials/
    |-- database/
    |   `-- database.sql
    |-- backup.log
    |-- manifest.json
    `-- RESTORE-NOTES.txt
```

The default backup includes:

- n8n CLI workflow export.
- n8n CLI credential export.
- Postgres `pg_dump` when a Compose Postgres service is configured.
- A manifest file.
- Restore notes.
- A run log.
- Retention cleanup for old `n8n-production-*` folders.

Decrypted credential export is disabled by default. Only enable it for a deliberate break-glass export by setting both:

```bash
N8N_BACKUP_EXPORT_DECRYPTED_CREDENTIALS=1
N8N_BACKUP_CONFIRM_DECRYPTED_EXPORT=EXPORT_DECRYPTED_CREDENTIALS
```

Decrypted credential files contain secret values in plain text. Keep them out of Git, chats, tickets, screenshots, shared drives, and support bundles.

## Configure

Copy `n8n-production-backup.sh.template` to the server, install it as `n8n-production-backup.sh`, and run it from the directory that owns the n8n Docker Compose deployment, or set `N8N_STACK_DIR`.

Common environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `N8N_STACK_DIR` | current directory | Directory containing the Compose file. |
| `N8N_BACKUP_ROOT` | `<stack-dir>/backups` | Must not be `/`, `$HOME`, or the stack root itself. |
| `N8N_BACKUP_RETENTION_DAYS` | `30` | Old `n8n-production-*` folders older than this are removed. |
| `N8N_SERVICE_NAME` | `n8n` | Compose service that runs the n8n CLI. |
| `N8N_BACKUP_POSTGRES_SERVICE` | `postgres` | Compose service for `pg_dump`; set empty only when the database is external or provider-managed. |
| `POSTGRES_USER` | `n8n` | Database user for `pg_dump`. |
| `POSTGRES_DB` | `n8n` | Database name for `pg_dump`. |
| `N8N_BACKUP_EXPORT_DECRYPTED_CREDENTIALS` | `0` | Leave disabled unless explicitly approved for break-glass recovery. |

If Coolify or your deployment platform uses different service names, set the service variables explicitly.

## Run Once

Example:

```bash
cd /data/coolify/applications/<n8n-resource>
N8N_BACKUP_ROOT=/data/backups/n8n-production \
N8N_BACKUP_RETENTION_DAYS=30 \
/usr/local/sbin/n8n-production-backup
```

Do not paste real server paths, domains, project names, or secrets into public repo files.

## Schedule With systemd

Recommended for Linux servers:

```ini
# /etc/systemd/system/n8n-production-backup.service
[Unit]
Description=n8n production backup

[Service]
Type=oneshot
WorkingDirectory=/data/coolify/applications/<n8n-resource>
Environment=N8N_BACKUP_ROOT=/data/backups/n8n-production
Environment=N8N_BACKUP_RETENTION_DAYS=30
ExecStart=/usr/local/sbin/n8n-production-backup
```

```ini
# /etc/systemd/system/n8n-production-backup.timer
[Unit]
Description=Run n8n production backup daily

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable only after the owner approves the server change:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now n8n-production-backup.timer
systemctl list-timers n8n-production-backup.timer
```

## Schedule With cron

Cron is also acceptable when that is the server standard:

```cron
15 3 * * * cd /data/coolify/applications/<n8n-resource> && N8N_BACKUP_ROOT=/data/backups/n8n-production N8N_BACKUP_RETENTION_DAYS=30 /usr/local/sbin/n8n-production-backup >> /data/backups/n8n-production/cron.log 2>&1
```

Use systemd or cron for Linux server scheduling. Do not use Windows Task Scheduler for this production/server path.

## Restore Notes

Each backup folder writes `RESTORE-NOTES.txt`. Treat restore as a maintenance-window operation:

- Preserve the original `N8N_ENCRYPTION_KEY`; encrypted credential exports need it.
- Import workflow and credential exports only after confirming the target n8n version and database state.
- Restore Postgres only after a separate current-state backup and owner approval.
- Verify login, workflows, credentials, and representative webhooks after restore.

Offsite or cloud storage is intentionally not configured by this template. Add it later as a hardening item only after the local server backup and restore process is proven and the storage pattern is approved.
