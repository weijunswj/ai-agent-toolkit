<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Sync Overview

## Goal

Keep repo workflow templates reusable while avoiding live-only state, credentials, credential bindings, and accidental product data.

## Boundary

This is a short reviewed operating overview and safety wrapper. It is not the full runtime guide.

## Safe Operating Shape

- After scoped user approval in a consumer repo, agents may run non-live local helper actions only for the approved repo and operation: validate repo workflow JSON, sanitise/check local candidate exports, compare/diff already-exported local files, prepare import payloads into ignored `.tmp/**`, or check ignored `.n8n-local/**` credential-binding metadata.
- Move live workflow JSON through ignored scratch locations in the consumer repo.
- Strip live-only fields, credentials, webhook IDs, static data, tags unless intentionally preserved, and pin data.
- Keep repo workflow JSON inactive.
- Store local credential binding metadata only in ignored `.n8n-local/`.
- Review the diff before any live write.
- Prepare live payloads in ignored `.tmp/`.
- Run live sync only after explicit current-turn approval naming the target repo, target n8n instance/environment, allowed operation, workflow names/set, and forbidden operations.

The helper templates intentionally support scoped writes in consumer repos:

- `n8n-workflows/*.json` for reviewed workflow source updates.
- `.tmp/**` for transient live-sync payloads.
- `.n8n-local/**` for local credential-binding metadata.

Live-gated actions include live export/import/sync, activation/deactivation, publish/unpublish, archive/delete, execution, and credential creation/update/delete/binding/replacement.

Never run live sync helpers in CI, and never commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, live scratch payloads, credential binding files, `.env`, or secrets.

Stop and ask again if approval does not name the target repo; live approval does not name the target instance/environment or workflow set; the operation is broader than approved; credentials would be touched unexpectedly; activation, publish, delete, archive, or execution would happen unexpectedly; workflow matching is ambiguous; credential bindings are missing, stale, or ambiguous; or ignored scratch folders contain commit-worthy changes. Use the approval examples in `SKILL.md`.

## Toolkit Templates

Use `templates/helper-scripts/import-export-sync/` as review-required template assets. Copy them into a consumer repo only after reviewing the target workflow policy.

Do not run those helper scripts from this toolkit repo.
