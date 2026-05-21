<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.mcp-ready-registry
Source: _projects/repo-methodology/mcp-ready-registry/_main/references/installer-mcp.md
Update the project source and run sync.
-->
# Installer MCP

The installer MCP is future-facing in v1. It is design/spec-only material for a possible installer that would install only pack-defined files after explicit approval.

This is MCP-ready registry and design/spec material. It is not a runnable MCP server.

## Intended Flow

1. Read skill-local pack manifests through [the pack registry](../registry/packs.registry.json).
2. Resolve source files inside this toolkit.
3. Preview target writes.
4. Ask for approval.
5. Write only approved files.

## Boundaries

No arbitrary shell execution. No arbitrary read or write target. No upstream auto-apply. No auto-merge. No destructive product repo actions.

See [Installer MCP spec](../installer-mcp/SPEC.md) and [Installer MCP security](../installer-mcp/SECURITY.md).
