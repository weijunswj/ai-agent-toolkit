# Local n8n Setup Project Module

This project module preserves the full local n8n setup source project and declares the root toolkit surfaces that depend on it.

## Layout

- [_main/](_main/) keeps the actual project files and original guide names.
- No curated or generated preview folder is used for this module.

Root-level consumer surfaces remain under [skills/](../../../skills/), [guides/](../../../guides/), [templates/](../../../templates/), [packs/](../../../packs/), [mcp/](../../../mcp/), and [registry/](../../../registry/).

## Preserved Source

The `_main/` folder preserves the local setup README, numbered setup guides, platform integration guides, templates, and safe helper scripts from the local n8n setup source project. The root-level guides are shorter consumer surfaces and should link back here when exact source context matters.

`_main/templates/**` is preserved original project source. Root agent-rule templates are generated from `_main/templates/partials/*.md` plus the linked toolkit-only partial at [templates/agent-rules/partials/skill-routing-rules.md](../../../templates/agent-rules/partials/skill-routing-rules.md).

## Safety

This module does not authorize live n8n import/export, credential changes, or production workflow mutation. Live actions require explicit confirmation and must not run in CI.
