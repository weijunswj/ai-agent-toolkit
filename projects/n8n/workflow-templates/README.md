# n8n Workflow Templates Project Module

This project module preserves the n8n workflow-template source material and exposes curated toolkit surfaces for safe workflow sync, sanitizer helpers, and workflow policy.

## Layout

- [main/](main/) keeps the actual README, scripts, and template workflow files.
- [exports/](exports/) contains curated sources for root-level skills, MCP docs, guides, packs, templates, and registry entries.
- [_generated/](_generated/) is reserved for optional previews only.

## Safety

The source scripts in `main/` are archived source material. They are not executed by the toolkit sync workflow just because they exist. Live n8n import/export remains explicit-confirmation only and never runs in CI.
