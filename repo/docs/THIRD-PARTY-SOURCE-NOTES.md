# Third-Party Source Notes

The external `nextlevelbuilder/ui-ux-pro-max-skill` project is used only for the safe local-search subset documented in [_projects/design/ui-ux-pro-max/](../../_projects/design/ui-ux-pro-max/).

Reviewed source:

- `nextlevelbuilder/ui-ux-pro-max-skill`
- Public GitHub repo and README/tree
- Reviewed date: 2026-05-16

## What Was Used

The toolkit vendors/adapts only the local-search subset:

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- Required CSV data under `src/ui-ux-pro-max/data/`

## What Was Not Used

This toolkit does not vendor external:

- CLI scripts.
- Generated templates.
- Assets.
- Screenshots.
- Package metadata.
- Install commands.

Project-owned scripts preserved under `_projects/**/_main/` are source material, not automatically trusted runtime code.
