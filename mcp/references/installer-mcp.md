# Installer MCP

The installer MCP is future-facing in v1. It is intended to install only pack-defined files after explicit approval.

## Intended Flow

1. Read skill-local pack manifests through [the pack registry](../registry/packs.registry.json).
2. Resolve source files inside this toolkit.
3. Preview target writes.
4. Ask for approval.
5. Write only approved files.

## Boundaries

No arbitrary shell execution. No arbitrary read or write target. No upstream auto-apply. No auto-merge. No destructive product repo actions.

See [Installer MCP spec](../installer-mcp/SPEC.md) and [Installer MCP security](../installer-mcp/SECURITY.md).
