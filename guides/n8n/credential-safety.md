# Credential Safety

Source-derived from `weijunswj/codex-n8n-local-setup` n8n MCP rules and `weijunswj/ai-cicd-installer` n8n helper scripts.

## Rules

- Never store real credential values in workflow JSON.
- Never store credential exports in repo files.
- Never commit credential binding files.
- Never write tokens, private keys, passwords, or bearer values into sticky notes, examples, docs, or Set nodes.
- Use n8n credentials on nodes instead of hardcoded headers or query parameters.

## Local Binding Metadata

Credential binding metadata can be useful during repo/live sync, but it must stay local and ignored. Use `.n8n-local/` in a consumer repo and never commit it.

## Templates

Use obvious placeholders only, such as `SERVICE_URL` or `ALERT_EMAIL`. Do not use realistic fake secrets.
