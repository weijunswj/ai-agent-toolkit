# Upgrading n8n

Source-derived from `weijunswj/codex-n8n-local-setup` file `2. upgrading.md`.

## Before Updating

1. Back up workflows or take a snapshot.
2. Record the current n8n version.
3. Know whether the install is local Docker, Docker Compose, hosted VPS, or npm.
4. Read release notes before large jumps.
5. Plan a quick smoke test.

## Local Docker Pattern

For local Docker, pull the target image, recreate the container, and preserve the Docker volume. Do not delete the volume unless the goal is to delete local n8n data.

## Docker Compose Pattern

For Compose-based installs:

```bash
docker compose pull
docker compose down
docker compose up -d
```

Run from the folder that owns the Compose file.

## Smoke Test

- Login works.
- Credentials still decrypt.
- Webhook URLs are correct.
- Scheduled workflows still run.
- Community nodes still load if used.
