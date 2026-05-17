<!--
Root published toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: n8n.workflow-templates
Review the related _projects/**/_main source when updating.
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
