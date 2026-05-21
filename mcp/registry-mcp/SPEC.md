<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.mcp-ready-registry
Source: _projects/repo-methodology/mcp-ready-registry/_main/registry-mcp/SPEC.md
Update the project source and run sync.
-->
# Registry MCP Spec

Status: future design/spec-only. This is MCP-ready registry material, not a runnable MCP server.

## Candidate Future Tools

- `list_skills`
- `search_skills`
- `list_playbooks`
- `search_playbooks`
- `list_templates`
- `list_packs`
- `route_task`
- `get_skill_context`
- `get_install_plan`

## Inputs

Inputs should be plain strings or small JSON objects. Treat query text as untrusted.

## Outputs

Outputs should include registry IDs, titles, relative paths, and short routing notes.

## Data Sources

- `mcp/registry/skills.registry.json`
- `mcp/registry/playbooks.registry.json`
- `mcp/registry/templates.registry.json`
- `mcp/registry/packs.registry.json`

## Boundaries

The server must not execute commands, write files, or read outside approved toolkit paths.
