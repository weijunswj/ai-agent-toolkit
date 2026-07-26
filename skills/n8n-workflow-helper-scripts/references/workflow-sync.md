<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/references/workflow-sync.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Sync Overview

## Goal

Keep canonical repo workflows portable while avoiding live-only state, target credential IDs/values, private resource locators, and accidental product data.

## Boundary

This is a short safety wrapper, not the full runtime guide.

## Safe Operating Shape

- Scoped non-live approval permits validation and local preparation only for the named consumer repo and operation.
- Move live workflow JSON through ignored scratch locations in the consumer repo.
- Strip live-only fields, target credential IDs, webhook IDs, static data, tags unless intentionally preserved, and pin data; preserve portable logical credential names/types and approved canonical workflow logic.
- Keep repo workflow JSON inactive.
- Store exact private resource bindings and sanitized reports only in ignored `.n8n-local/`; target IDs remain transient.
- Rebuild import payloads from canonical Git, validate the canonical invariant, and compare the effective prepared payload before any live write.
- Prepare live payloads in ignored `.tmp/`.
- Run live sync only after explicit current-turn approval naming the target repo, target n8n instance/environment, allowed operation, workflow names/set, and forbidden operations.

Live-gated actions include live export/import/sync, activation/deactivation, publish/unpublish, archive/delete, execution, and credential creation/update/delete/binding/replacement.

Never run live sync helpers in CI, and never commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, live scratch payloads, credential binding files, `.env`, or secrets.

Stop if approval or target scope is incomplete; workflow or node matching is ambiguous; credential discovery or exact name/type resolution fails; a required exact resource binding is missing; the canonical invariant fails; or activation, execution, publish, delete, archive, or an unexpected credential change could occur.

## Toolkit Templates

Use `templates/helper-scripts/import-export-sync/` as review-required template assets. Copy them into a consumer repo only after reviewing the target workflow policy.

Do not run those helper scripts from this toolkit repo.
