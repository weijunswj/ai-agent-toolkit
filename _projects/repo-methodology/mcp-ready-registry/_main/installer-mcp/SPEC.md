# Installer MCP Spec

Status: future design/spec-only. This is MCP-ready registry material, not a runnable MCP server.

## Flow

1. Read `packs.registry.json`.
2. Read the selected `pack.json`.
3. Resolve declared source paths inside the toolkit.
4. Build a write preview.
5. Ask for approval.
6. Write only approved files.
7. Return a report.

## Pack Contract

Each pack must define:

- `id`
- `title`
- `description`
- `status`
- `risk_level`
- `source_refs`
- `suitable_for`
- `installs`
- `writes_allowed`
- `writes_denied`
- `requires_approval`
- `run_commands`
- `notes`

## Boundaries

The installer must not run commands, mutate live systems, apply upstream updates, create PRs, merge, delete files outside approved writes, or install credentials.
