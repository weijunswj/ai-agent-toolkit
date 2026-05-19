---
name: n8n-workflow-helper-scripts
description: Use for safe n8n workflow helper-script templates, including sanitizer helpers, import/export sync helpers, validation, comparison, live-import preparation, and repo/live workflow hygiene. Applies when copying, reviewing, or explaining these helper scripts for a consumer repo.
---

<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Helper Scripts

Use this instruction-only skill when the user wants to copy, review, adapt, or reason about reusable n8n workflow helper scripts.

## Use When

- Sanitizing raw n8n workflow exports into reviewed template candidates.
- Validating generic n8n workflow JSON before import or publication.
- Comparing repo workflows against live exports.
- Preparing reviewed repo workflow JSON for live import.
- Preserving local credential bindings in ignored consumer-repo metadata.
- Explaining `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**` hygiene.

## Do Not Use When

- The task is unrelated to n8n workflow files or helper scripts.
- The user asks only for actual reusable workflow JSON templates.
- The request would run live n8n import/export without explicit current-turn confirmation.

## Rules

- Treat these scripts as review-required templates, not trusted runtime code.
- Do not run live n8n import/export from this toolkit repo.
- Do not run live n8n import/export in CI.
- Do not commit `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, `.sanitised/**`, live import/export JSON, credentials, credential bindings, private keys, or `.env` files.
- Keep consumer-repo workflow JSON inactive unless the user explicitly confirms activation in the target live instance.
- Review workflow diffs before committing `n8n-workflows/*.json` in a consumer repo.

## References

- `references/workflow-sync.md`: repo/live sync boundary and safety wrapper.
- `references/import-export-flow.md`: import/export review flow.
- `references/credential-safety.md`: credential and binding hygiene.
- `references/n8n-credential-safety.md`: n8n local binding metadata rules.

## Templates

- `templates/helper-scripts/sanitizer/`: sanitizer helper scripts.
- `templates/helper-scripts/import-export-sync/`: import/export, validation, compare, prepare, and sync helper scripts.

## Output

Report:

- Source inspected.
- Helper scripts used or copied.
- Scoped writes allowed in the consumer repo.
- Files excluded and why.
- Validation to run.
- Any live action that still needs explicit confirmation.
