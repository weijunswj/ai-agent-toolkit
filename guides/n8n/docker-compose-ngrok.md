# Docker Compose Plus ngrok

Source-derived from `weijunswj/codex-n8n-local-setup` file `3a. docker compose + ngrok.md`.

This pattern is for local development only. It combines Docker Compose management with a temporary ngrok public URL.

## Use When

- You want a readable Compose file for local n8n.
- You still need a temporary public webhook URL.
- You want a stepping stone before real VPS hosting.

## Do Not Use When

- You need production hosting.
- You are on a VPS, Hostinger, Coolify, or always-on public deployment.

## Key Idea

The helper reads the current ngrok HTTPS URL and writes it into local environment config for Compose. The committed template should not include real tunnel URLs, tokens, or local credential files.
