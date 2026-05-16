# Tunnelling

Source-derived from `weijunswj/codex-n8n-local-setup` file `3. tunneling guide.md`.

Use tunnelling only for local development when an external service must call local n8n.

## When To Use

- Testing webhooks.
- Testing OAuth callbacks.
- Letting a service call a local laptop or desktop.

## When Not To Use

Do not use tunnels as permanent hosting. Use VPS hosting or n8n Cloud when the service must be always-on.

## Required n8n Settings

When n8n is behind a tunnel or reverse proxy, configure:

- `WEBHOOK_URL` as the public URL.
- `N8N_PROXY_HOPS=1`.

Keep tunnel URLs and tokens out of repo files.
