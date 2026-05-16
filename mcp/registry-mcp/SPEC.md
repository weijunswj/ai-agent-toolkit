# Registry MCP Spec

Status: future design only.

## Tools

- `list_skills`
- `search_skills`
- `list_guides`
- `search_guides`
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

- `registry/skills.registry.json`
- `registry/guides.registry.json`
- `registry/templates.registry.json`
- `registry/packs.registry.json`

## Boundaries

The server must not execute commands, write files, or read outside approved toolkit paths.
