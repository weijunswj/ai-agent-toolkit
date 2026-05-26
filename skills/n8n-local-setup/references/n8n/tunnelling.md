<!--
Generated from toolkit project source. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/_main/3. tunneling guide.md
Update the project source and run sync.
-->
# 3. Tunneling Guide

This guide is for local development only.

The only supported local tunnel path in this guide is ngrok running as a Docker Compose service. Cloudflare tunnels and the built-in n8n tunnel are intentionally out of scope here so beginners and agents follow one path.

Do not use tunneling as permanent hosting. If you need always-on public n8n, use [4. VPS Hosting](./4.%20vps%20hosting.md).

## When You Need A Tunnel

Use the local ngrok tunnel when an outside service needs to call your local n8n.

Examples:

- Stripe webhooks
- Telegram webhooks
- GitHub webhooks
- Typeform webhooks
- Meta webhooks
- OAuth callbacks

You do not need a public tunnel just for Codex talking to local `n8n_live` if Codex can reach `http://localhost:5678`.

## Blessed Tunnel Shape

The local stack runs:

```text
outside service
-> https://your-reserved-domain.ngrok.app
-> ngrok Compose service
-> n8n Compose service on n8n:5678
```

The n8n container remains bound to loopback on your host:

```text
http://localhost:5678
```

The public URL comes from ngrok.

## Required `.env` Values

Set these in the local `.env` copied from [.env.example](../../templates/local-stack/.env.example):

```dotenv
NGROK_AUTHTOKEN=replace-with-ngrok-authtoken
NGROK_DOMAIN=your-reserved-domain.ngrok.app
WEBHOOK_URL=https://your-reserved-domain.ngrok.app/
N8N_HOST=your-reserved-domain.ngrok.app
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1
```

Use the same reserved ngrok domain in `NGROK_DOMAIN`, `N8N_HOST`, and `WEBHOOK_URL`. `WEBHOOK_URL` includes `https://` and a trailing slash. `NGROK_DOMAIN` and `N8N_HOST` do not.

Do not commit `.env`.

## Start Or Refresh The Tunnel

From the local stack folder:

```powershell
docker compose up -d
```

If you changed `.env`, recreate the stack:

```powershell
docker compose up -d --force-recreate
```

Open local n8n:

```text
http://localhost:5678
```

Open the local ngrok inspector if you need to debug requests:

```text
http://127.0.0.1:4040
```

Use the ngrok HTTPS URL from `WEBHOOK_URL` when configuring external webhooks.

## Unsupported In This Guide

These are not supported Fast Path options here:

- Manual Windows ngrok install or helper scripts.
- Cloudflare Quick Tunnel.
- Cloudflare named tunnels.
- n8n's built-in tunnel.
- Random temporary tunnel URLs that require rewriting `.env` every run.

Those paths may exist elsewhere, but they are deliberately outside this local setup guide.

## Safety Notes

- Do not expose the n8n container directly to the LAN or internet.
- Do not paste webhook URLs, tokens, or secrets into repo files.
- Do not treat ngrok as production hosting.
- Do not run live imports, exports, workflow execution, activation, deactivation, or credential changes from this toolkit repo.

## Template Details

Use [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) for the full Compose template explanation.
