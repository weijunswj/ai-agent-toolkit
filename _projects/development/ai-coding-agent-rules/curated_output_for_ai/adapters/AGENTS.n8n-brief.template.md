<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->
## n8n Agent Rules Adapter

This repo contains or may contain n8n workflow/helper work.

For any n8n task, follow the `n8n-agent-rules` skill or local n8n rule reference before planning or editing.

n8n tasks include workflow JSON, n8n MCP, n8n_docs, n8n_live, import/export, helper scripts, validation, credentials, webhook IDs, activation, execution, repo/live sync, and workflow templates.

If `n8n-agent-rules` is not available, stop and ask the user to install or provide it before making n8n workflow or live n8n changes.

Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, archive/delete, or credential actions without explicit current-turn approval naming:

- Target repo.
- Target n8n instance/environment.
- Allowed operation.
- Workflow names/set.
- Forbidden operations.
<!-- END N8N-AGENT-RULES-ADAPTER -->
