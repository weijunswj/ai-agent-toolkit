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
