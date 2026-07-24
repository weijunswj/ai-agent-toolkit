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
- Never commit target-local credential IDs, encrypted credential exports, or credential values.
- Commit only the portable logical credential name/type declarations emitted beside canonical workflows.
- Never write tokens, private keys, passwords, or bearer values into sticky notes, examples, docs, or Set nodes.
- Use n8n credentials on nodes instead of hardcoded headers or query parameters.

## Target Metadata And Internal Binding

For the supported Docker/server CLI transport, encrypted credential export must remain inside restrictive Toolkit-owned target-local temporary storage. Extract only ID, name, and type, never decrypt, never print or report target IDs, reject link/reparse escapes, and clean up on success and failure.

Resolve only an exact unique logical name/type match. Missing, ambiguous, wrong-type, or unavailable discovery states stop or follow the officially supported unresolved inactive-import path; they never guess. Exact private resource bindings and sanitized reports remain ignored under `.n8n-local/**`.

## Templates

Use obvious placeholders only, such as `SERVICE_URL` or `ALERT_EMAIL`. Do not use realistic fake secrets.
