<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/templates/workflow-templates/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Templates

Reusable n8n workflow templates should be generic, inactive, and credential-free.

## Boundary

This is a short template index and safety checklist. It is not a helper-script runtime guide.

## Included Templates

- `error-handling/global-error-handler.template.json`: generic inactive global error-handler workflow template.
- `chatbot-with-RAG/customer-support-agent.workflow.template.json`: generic inactive RAG customer-support workflow template.
- `chatbot-with-RAG/rag-ingestion.workflow.template.json`: generic inactive RAG knowledge-base ingestion workflow template.

## Required

- `active: false`.
- No top-level credentials.
- No node credential IDs.
- No live `webhookId` values.
- No live `meta.instanceId`.
- No pin data, static data, or live-only version metadata.
- No real emails, URLs, customer IDs, sheet IDs, folder IDs, or account IDs.

## Prefer

- Clear node names.
- Short sticky notes.
- Required manual configuration only for non-secret literal values.
- Obvious placeholders such as `SERVICE_URL` or `ALERT_EMAIL`.
- Product-neutral examples.

## Avoid

- Product-specific workflow JSON.
- Customer payloads.
- Code nodes unless the template requires logic that built-in nodes cannot express.
- Credential placeholders that look like real secrets.
