# n8n Workflows Playbook

Use this for n8n workflow JSON, root `n8n-workflows/`, n8n helper scripts, import/export, repo/live sync, credentials, activation, execution, or live n8n safety.

## Approval Gates

Stop before live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, production, destructive, or privileged external actions.

Require explicit current-turn approval naming the target repo, target n8n instance or environment, allowed operation, workflow set, and forbidden operations.

## Repository Layout

Committed n8n workflow export JSON belongs under root `n8n-workflows/`. Do not store committed workflow JSON randomly under `docs/`, `scripts/`, `.n8n/`, `.tmp/`, app folders, or scratch paths.

If `n8n-workflows/` exists, include `n8n-workflows/README.md`. Use stable lowercase hyphenated workflow filenames such as `member-intake-small-batch.json`; use `archived/` only for intentionally retained old exports.

If Toolkit creates or manages root `n8n-workflows/`, install or sync the approved n8n import/export helper scripts into `n8n-workflows/scripts/`. Helper scripts must support safe manual import/export workflows but must not run automatically.

## Safety

Never commit secrets, credentials, tokens, cookies, webhook secrets, private environment values, credential bindings, live import/export payloads, production execution data, `.env` files, `.n8n/` runtime folders, n8n database files, binary backups, or live execution exports.

If workflow JSON includes credential references, keep them non-secret and document required environment variable names separately with placeholders only.

Helper scripts must not print secrets or default to destructive live actions.

## Agent Workflow

Before adding or editing n8n workflow JSON, inspect `n8n-workflows/README.md` and existing workflow names.

Use targeted searches and bounded reads. Validate JSON syntax after editing.

Summarize changed workflows by filename and purpose. Never claim a workflow is deployed, imported, activated, or executed unless that live action was explicitly approved, performed, and validated in the current turn.
