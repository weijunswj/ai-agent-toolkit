<!--
Curated AI-facing source.
Project: n8n.workflow-templates
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Sync Overview

## Goal

Keep repo workflow templates reusable while avoiding live-only state, credentials, credential bindings, and accidental product data.

## Boundary

This is a short reviewed operating overview and safety wrapper. It is not the full runtime guide.

## Safe Operating Shape

- Move live workflow JSON through ignored scratch locations in the consumer repo.
- Strip live-only fields, credentials, webhook IDs, static data, tags unless intentionally preserved, and pin data.
- Keep repo workflow JSON inactive.
- Store local credential binding metadata only in ignored `.n8n-local/`.
- Review the diff before any live write.
- Prepare live payloads in ignored `.tmp/`.
- Run live sync only after explicit confirmation in the consumer repo.

The helper templates intentionally support scoped writes in consumer repos:

- `n8n-workflows/*.json` for reviewed workflow source updates.
- `.tmp/**` for transient live-sync payloads.
- `.n8n-local/**` for local credential-binding metadata.

Never run live sync helpers in CI, and never commit `.tmp/**`, `.n8n-local/**`, live scratch payloads, or credential binding files.

## Toolkit Templates

Use [n8n sync helpers](../../templates/sync-helpers/) as review-required template assets. Copy them into a consumer repo only after reviewing the target workflow policy.

Do not run those helper scripts from this toolkit repo.
