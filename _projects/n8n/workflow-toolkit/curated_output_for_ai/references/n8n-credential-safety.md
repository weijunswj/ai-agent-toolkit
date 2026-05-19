<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Credential Safety Reference

This is the n8n-specific companion to the skill-level credential checklist in `references/credential-safety.md`.

## Boundary

This is a short skill-local reference and safety checklist. It is not the full runtime helper guide.

## Rules

- Never store real credential values in workflow JSON.
- Never store credential exports in repo files.
- Never commit credential binding files.
- Never write tokens, private keys, passwords, or bearer values into sticky notes, examples, docs, or Set nodes.
- Use n8n credentials on nodes instead of hardcoded headers or query parameters.

## Local Binding Metadata

Credential binding metadata can be useful during repo/live sync, but it must stay local and ignored. Use `.n8n-local/` in a consumer repo and never commit it.

The sync helpers may write `.n8n-local/**` during reviewed local runs so imports can restore credential references without committing credential values. Treat those files as local machine state.

## Templates

Use obvious placeholders only, such as `SERVICE_URL` or `ALERT_EMAIL`. Do not use realistic fake secrets.
