<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-templates
Source: _projects/n8n/workflow-templates/curated_output_for_ai/templates/n8n/sanitizer/README.md
Update the curated output and run sync.
-->
# n8n Sanitizer Templates

This folder contains reusable sanitizer helper templates for n8n workflow JSON.

The sanitizer turns raw n8n workflow exports into reviewed template candidates by stripping live-only metadata, credentials, webhook IDs, pinned data, and likely live IDs.

## Intended Scoped Writes

When run in a reviewed consumer repo, the PowerShell wrapper may create and write:

- `.to-sanitise/**`
- `.sanitised/**`

Both folders must remain ignored and uncommitted. Review sanitized outputs before moving any generic, inactive, credential-free template into a tracked folder.

## Entry Points

- `sanitise-n8n-template.ps1`
- `- sanitise-n8n-template.cmd`
- `prepare-n8n-template.js`

Use `-DryRun` with the PowerShell script to confirm paths without writing sanitized template files.
