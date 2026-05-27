# Registry

Registries are JSON-only MCP-ready registry metadata files for toolkit discovery.

Files:

- `skills.registry.json`
- `playbooks.registry.json`
- `templates.registry.json`
- `packs.registry.json`
- `projects.registry.json`
- `tools.registry.json`
- `source-repos.registry.json`
- `consumers.registry.json`

All paths referenced by registries must exist.

`playbooks.registry.json` is a manual discovery registry over reference documents. It does not make `playbooks/` a default source folder, and it must not be used to publish full runtime instructions from curated summaries.
