# Installer MCP

The installer MCP is future-facing in v1. It is intended to install only pack-defined files after explicit approval.

## Intended Flow

1. Read `packs/*/pack.json`.
2. Resolve source files inside this toolkit.
3. Preview target writes.
4. Ask for approval.
5. Write only approved files.

## Boundaries

No arbitrary shell execution. No arbitrary read or write target. No upstream auto-apply. No auto-merge. No destructive product repo actions.

See `mcp/installer-mcp/SPEC.md` and `mcp/installer-mcp/SECURITY.md`.
