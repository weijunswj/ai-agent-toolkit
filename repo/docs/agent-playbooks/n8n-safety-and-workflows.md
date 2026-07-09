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

## Workflow Layout

Committed n8n workflow export JSON belongs under the repo root `n8n-workflows/`. Do not scatter committed workflow JSON under `docs/`, `scripts/`, `.n8n/`, `.tmp/`, app folders, or scratch paths.

If `n8n-workflows/` exists, include `n8n-workflows/README.md`. Use stable lowercase hyphenated workflow filenames, and use `archived/` only for intentionally retained old exports.

When Toolkit creates or manages root `n8n-workflows/`, install or sync the approved import/export helper scripts into `n8n-workflows/scripts/`. Helpers must be manual only and must not run live import/export/sync/activation/execution without explicit current-turn approval naming the target and allowed operation.

Before adding or editing workflow JSON, inspect `n8n-workflows/README.md` and existing workflow names, validate JSON syntax after editing, and summarize changed workflows by filename and purpose.
