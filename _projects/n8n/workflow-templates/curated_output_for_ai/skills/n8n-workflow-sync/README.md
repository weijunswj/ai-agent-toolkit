<!--
Curated AI-facing source.
Project: n8n.workflow-templates
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Sync

This skill helps AI agents handle reusable n8n workflow sync and template hygiene without leaking credentials or product data.

It is generic, credential-free, and product-neutral.

## What It Covers

- Safe repo/live workflow sync planning.
- Credential binding safety.
- Template sanitation.
- Inactive workflow template checks.
- Import/export review before any live action.

## What It Does Not Include

- Live workflow JSON from product repos.
- Credential exports.
- Committed credential binding files.
- `.env`, committed `.n8n-local/`, or committed `.tmp/`.
- Product-specific node names or customer data.
- Runtime scripts inside the skill folder.

The related helper templates may write ignored `.n8n-local/**` and `.tmp/**` in a reviewed consumer repo. Those local outputs must never be committed.

## Related Toolkit Templates

- [n8n sync helpers](../../../templates/n8n/sync-helpers/)
- [n8n sanitizer](../../../templates/n8n/sanitizer/)
- [n8n workflow policy](../../../templates/n8n/workflow-policy/)
