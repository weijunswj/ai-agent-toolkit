# Workflow Template Hygiene

Reusable n8n templates should be generic, inactive, and credential-free.

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
