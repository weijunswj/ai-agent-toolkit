# Registry MCP Spec

Status: future design only.

## Tools

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

- `for_ai/registry/skills.registry.json`
- `for_ai/registry/playbooks.registry.json`
- `for_ai/registry/templates.registry.json`
- `for_ai/registry/packs.registry.json`

## Boundaries

The server must not execute commands, write files, or read outside approved toolkit paths.
