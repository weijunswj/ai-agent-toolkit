<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.mcp-ready-registry
Source: _projects/repo-methodology/mcp-ready-registry/_main/installer-mcp/SECURITY.md
Update the project source and run sync.
-->
# Installer MCP Security

The installer MCP must preview every write before making changes.

## Required

- Install only files declared by `pack.json`.
- Ask for approval before writes.
- Reject unsafe write targets.
- Reject secrets, credential exports, `.env`, `.n8n-local/`, `.tmp/`, private keys, live imports, and live exports.

## Forbidden

- Arbitrary shell execution.
- Arbitrary source paths.
- Arbitrary target paths.
- Auto-applying upstream updates.
- Auto-merge.
- Product repo destructive actions.
- Credential modification.
