<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/references/credential-safety.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Credential Safety Reference

This is the skill-level credential checklist for workflow sync review. For n8n local credential binding metadata, use `references/n8n-credential-safety.md`.

## Boundary

This is a short skill-local reference and safety checklist. It is not the full runtime helper guide.

## Safe Defaults

- Use n8n credential objects in the live instance.
- Keep local credential binding metadata in ignored `.n8n-local/` only.
- Keep live import/export payloads in ignored `.tmp/` only.
- Use obvious placeholders for template values.
- Document manual credential assignment by node and field, not by secret value.

## Unsafe

- Hardcoded authorization headers.
- Token values in Set nodes.
- Credential IDs in committed workflow JSON.
- Sticky notes containing credential names that reveal private systems.
- Live export files committed to repo.
