<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Sanitizer Helpers

This folder contains reusable sanitizer helper-script templates for n8n workflow JSON.

The sanitizer turns raw n8n workflow exports into reviewed template candidates by stripping live-only metadata, credentials, webhook IDs, pinned data, and likely live IDs.

## Intended Scoped Writes

When run in a reviewed consumer repo, the PowerShell wrapper may create and write:

- `.to-sanitise/**`
- `.sanitised/**`

Both folders are created at the repo root, not inside the copied helper folder. They must remain ignored and uncommitted. Review sanitized outputs before moving any generic, inactive, credential-free template into a tracked folder.

## Entry Points

- `sanitise-n8n-template.ps1`
- `_sanitise-n8n-template.cmd`
- `prepare-n8n-template.js`

## Wrapper Working Directory

The `.cmd` wrapper invokes the co-located PowerShell script with `%~dp0sanitise-n8n-template.ps1` and does not change directory itself. The PowerShell script resolves the repo root from its script location, sets its working directory to that repo root, and executes the co-located `prepare-n8n-template.js` script by absolute path.

Use `-DryRun` with the PowerShell script to confirm paths without writing sanitized template files.
