# n8n Safety And Workflows Playbook

Use this for n8n workflow JSON, templates, helper scripts, MCP, import/export, live n8n, credentials, activation, execution, repo/live sync, webhook IDs, static data, or n8n safety.

## Required Rules

Load `skills/n8n-agent-rules` before planning or editing n8n workflow or live n8n material. Follow the full n8n operating contract there.

## Approval Gates

Stop before live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, production, destructive, or privileged external actions.

Require explicit current-turn approval naming the target and allowed operation.

## Repository Safety

Never commit secrets, credentials, tokens, webhook secrets, private keys, `.env` values, credential bindings, live import/export payloads, live webhook IDs, or environment-specific workflow static data.

Reusable workflow templates must stay generic, inactive, credential-free, and safe for publication.
