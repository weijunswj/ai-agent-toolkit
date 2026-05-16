# Local n8n Setup Project Module

This project module preserves the full local n8n setup source project and exposes curated toolkit surfaces from explicit exports.

## Layout

- [main/](main/) keeps the actual project files and original guide names.
- [exports/](exports/) contains curated sources for root-level skills, MCP docs, guides, packs, and templates.
- [_generated/](_generated/) is reserved for optional previews only.

Root-level consumer surfaces remain under [skills/](../../../skills/), [guides/](../../../guides/), [templates/](../../../templates/), [packs/](../../../packs/), [mcp/](../../../mcp/), and [registry/](../../../registry/).

## Preserved Source

The `main/` folder preserves the local setup README, numbered setup guides, platform integration guides, templates, and safe helper scripts from the local n8n setup source project. The root-level guides are shorter consumer surfaces and should link back here when exact source context matters.

## Safety

This module does not authorize live n8n import/export, credential changes, or production workflow mutation. Live actions require explicit confirmation and must not run in CI.
