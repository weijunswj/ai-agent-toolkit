# Source Manifest: UI/UX Pro Max Design

## Preserved In `_main/`

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- `src/ui-ux-pro-max/data/*.csv`
- `src/ui-ux-pro-max/data/stacks/*.csv`

The preserved scripts are the toolkit-adapted local-only subset used by [for_ai/tools/design-system-generator/](../../../for_ai/tools/design-system-generator/).

## AI-Facing Surfaces

- AI-facing skill, MCP doc, playbook, tool README, licence notes, and pack are directly maintained and declared as `linked`.
- AI-facing design generator scripts and CSV data are copied from `_main/src/ui-ux-pro-max/`.

## Excluded

- NPM package wrapper, CLI installer, screenshots, website assets, generated templates, package metadata, unrelated scripts, browser automation, installers, network/download logic, and shell-out behavior.
