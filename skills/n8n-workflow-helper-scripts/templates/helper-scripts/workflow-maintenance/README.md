# Workflow Maintenance Helpers

Local helper scripts for cautious n8n workflow cleanup.

## Delete Archived n8n Workflows

`delete-archived-n8n-workflows.cjs` uses the n8n public REST API to list archived workflows, dry-run by default, and delete only after explicit confirmation.

This is a local Node.js script, not an n8n workflow.

## MCP-first recommendation

When an AI agent has n8n MCP tools available, use MCP read/list tools first to review archived workflow candidates.

Use this REST API script only as a fallback when MCP tools are unavailable or cannot safely back up and delete workflows.

Do not use REST API fallback unless the user explicitly confirms API fallback.

### Required Environment Variables

```powershell
$env:N8N_BASE_URL = "https://your-n8n.example.com/api/v1"
$env:N8N_API_KEY = "your-api-key"
```

`N8N_BASE_URL` may be either the instance root or the `/api/v1` root. The script normalizes it before making API calls.

### Dry Run

```powershell
node delete-archived-n8n-workflows.cjs
```

Dry-run mode is the default. It fetches workflows, prints archived inactive unpublished candidates, and deletes nothing. It does not create backups.

### Confirmed Delete

```powershell
node delete-archived-n8n-workflows.cjs --delete --confirm "DELETE ARCHIVED WORKFLOWS"
```

Destructive delete requires both flags exactly. Before each delete, the script writes the full workflow JSON to:

```text
.n8n-workflow-backups/
```

Backup filenames use:

```text
YYYY-MM-DD_HHMM_<workflow-name>_<workflow-id>_before-delete.json
YYYY-MM-DD_HHMM_<workflow-id>_before-delete.json
```

### Safety Notes

- Use a scoped or minimum-permission n8n API key where available.
- The API key is read only from `N8N_API_KEY` and is never printed.
- Do not commit `.n8n-workflow-backups/`.
- Do not commit `.env`, API keys, live exports/imports, credential exports, or credential bindings.
- Do not run this script from CI.
- Review dry-run output before using destructive mode.
