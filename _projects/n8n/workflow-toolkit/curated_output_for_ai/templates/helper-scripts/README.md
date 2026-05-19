<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Helper Script Templates

This folder groups review-required n8n helper-script templates.

## Folders

- `sanitizer/`: turn raw n8n workflow exports into reviewed template candidates.
- `import-export-sync/`: validate, compare, sync, prepare, import, and export workflow files in a reviewed consumer repo.

## Safety Boundary

Do not run live import/export helpers from this toolkit repo or in CI.

When copied into a reviewed consumer repo, these helpers may write only their documented local paths, such as `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, ignored `.to-sanitise/**`, and ignored `.sanitised/**`.
