# Registry MCP

The registry MCP is future-facing in v1. It is designed as a read-only discovery server over this repo's JSON registries.

## Intended Use

- List skills.
- Search skills.
- List guides.
- Search guides.
- List templates.
- List packs.
- Route a task to useful toolkit assets.
- Return skill context.
- Return an install plan for a pack without writing files.

## Boundaries

The registry MCP must not run shell commands, write files, read arbitrary filesystem paths, or generate dynamic tool descriptions from untrusted skill text.

See [Registry MCP spec](../../mcp/registry-mcp/SPEC.md) and [Registry MCP security](../../mcp/registry-mcp/SECURITY.md).
