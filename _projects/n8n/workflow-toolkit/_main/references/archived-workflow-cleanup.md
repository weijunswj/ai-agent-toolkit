# Archived Workflow Cleanup

Use this runbook when an agent or operator needs to review or delete archived n8n workflows.

This is MCP-first guidance. The REST API cleanup script is a local fallback helper, not the first-choice agent path when n8n MCP tools are available.

## 1. Discover Whether MCP Is Available

First check whether n8n MCP tools are available in the current environment.

If n8n MCP tools are available, prefer MCP for the cleanup review.

If n8n MCP tools are unavailable or insufficient, stop and ask:

```text
n8n MCP tools are unavailable or insufficient for this cleanup. Do you want to use the local REST API fallback script instead?
```

Do not use REST API fallback unless the user explicitly confirms API fallback.

Do not use REST API fallback automatically.

## 2. MCP Dry-Run / Review Mode

When MCP tools are available, use MCP read/list tools to:

- List workflows.
- Identify archived workflows.
- Exclude active workflows.
- Exclude published workflows.
- Exclude non-archived workflows.
- Show candidate workflow ID, name, active/published status, project if available, and archive flag.
- Make no changes.

This review step is read-only.

## 3. MCP Destructive Mode

Before using MCP to delete any workflow, require explicit user confirmation in the current turn.

The confirmation must identify:

- The target environment.
- The candidate count.
- The candidate workflow IDs and names.
- Whether full workflow JSON backups can be captured first.

Do not delete if full workflow backup/read is unavailable or unclear.

If MCP cannot safely fetch or export full workflow JSON before deletion, stop and recommend the REST API fallback script instead, because the script backs up each target before delete.

## 4. REST API Fallback Mode

REST API fallback is allowed only if:

- n8n MCP tools are unavailable, insufficient, or cannot back up workflows before delete.
- The user explicitly confirms API fallback.
- The user provides `N8N_BASE_URL` and `N8N_API_KEY` through environment variables.
- The script remains dry-run by default.

Use this fallback dry-run command from the copied `workflow-maintenance/` folder:

```powershell
node delete-archived-n8n-workflows.cjs
```

Use this fallback destructive command only after explicit confirmation:

```powershell
node delete-archived-n8n-workflows.cjs --delete --confirm "DELETE ARCHIVED WORKFLOWS"
```

Destructive REST fallback still requires both flags exactly.

## Never Do This

Agents and operators must not:

- Use REST API fallback automatically.
- Delete active workflows.
- Delete published workflows.
- Delete non-archived workflows.
- Delete without a backup.
- Delete without explicit user confirmation.
- Print or commit API keys.
- Commit `.env`, credentials, live exports/imports, or `.n8n-workflow-backups/`.
- Run cleanup from CI.
