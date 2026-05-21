<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.mcp-ready-registry
Source: _projects/repo-methodology/mcp-ready-registry/_main/references/registry-mcp.md
Update the project source and run sync.
-->
# Registry MCP

The registry MCP is future-facing in v1. It is design/spec-only material for a possible read-only discovery server over this repo's JSON registries.

This is MCP-ready registry and design/spec material. It is not a runnable MCP server.

## Candidate Future Use

- List skills.
- Search skills.
- List playbooks.
- Search playbooks.
- List templates.
- List packs.
- Route a task to useful toolkit assets.
- Return skill context.
- Return an install plan for a pack without writing files.

## Boundaries

The registry MCP must not run shell commands, write files, read arbitrary filesystem paths, or generate dynamic tool descriptions from untrusted skill text.

See [Registry MCP spec](../../mcp/registry-mcp/SPEC.md) and [Registry MCP security](../../mcp/registry-mcp/SECURITY.md).
