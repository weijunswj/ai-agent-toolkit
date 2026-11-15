Title: design data refresh

### Changed

- **Design data:** The design-system generator's 28 CSV files now match upstream `nextlevelbuilder/ui-ux-pro-max-skill` at `0e8d408`, byte for byte, and every lock pin is the real upstream blob, so the old line-ending-only pins are gone.
- **Status filter:** Only rows upstream marks `active` rank in style and stack searches, so deprecated and supplemental styles never lead a recommendation. A stack query naming a legacy or deprecated generation still finds that stack's deprecated rows.
- **Right-to-left:** A recommended style now carries upstream's `rtl_level`, shown in the Markdown output too.

### Added

- **Source-lock refresh:** `repo/scripts/refresh-source-lock.cjs` turns a reviewed source-watch notice into a one-command refresh of an active source lock: it copies exact files, moves pins, lists new upstream files as excluded and refuses while an adapted file needs porting by hand.
