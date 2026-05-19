# Source Manifest: UI/UX Pro Max Design

## Preserved In `_main/`

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- `src/ui-ux-pro-max/data/*.csv`
- `src/ui-ux-pro-max/data/stacks/*.csv`
- `skill/README.md`
- `skill/INSTALL.md`
- `skill/LICENSE-THIRD-PARTY-NOTES.md`
- `skill/SKILL.md`
- `skill/agents/openai.yaml`
- `skill/examples/prompts.md`
- `skill/packs/**`
- `skill/references/**`
- `skill/tools/design-system-generator/README.md`
- `skill/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md`
- `skill/tools/design-system-generator/tests/test_local_only.py`

The preserved scripts are the toolkit-adapted local-only subset used by [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/).

`_main/skill/**` contains the canonical project-owned source for the copyable UI/UX skill folder. These files were promoted from the current published `skills/ui-ux-secure-frontend-design/**` folder so the pack-installed skill contents are source-owned and regenerated deterministically.

## AI-Facing Surfaces

- UI/UX skill files under `skills/ui-ux-secure-frontend-design/**` are generated from `_main/skill/**` or copied from `_main/src/ui-ux-pro-max/**`.
- AI-facing design generator scripts and CSV data are copied from `_main/src/ui-ux-pro-max/`.
- `mcp/projects/ui-ux-pro-max.md` remains a narrow linked MCP project note. This UI/UX skill ownership pass does not attempt MCP registry or MCP reference cleanup.

## Excluded

- NPM package wrapper, CLI installer, screenshots, website assets, generated templates, package metadata, unrelated scripts, browser automation, installers, network/download logic, and shell-out behavior.
- Credentials, `.env*`, private keys, live service state, generated package artifacts, and product repo files.
