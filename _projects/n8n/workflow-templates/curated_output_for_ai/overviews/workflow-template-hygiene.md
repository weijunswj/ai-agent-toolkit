<!--
Curated AI-facing source.
Project: n8n.workflow-templates
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Template Hygiene Reference

Reusable n8n templates should be generic, inactive, and credential-free.

## Boundary

This is a short skill-local reference and safety checklist. It is not the full runtime helper guide.

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
